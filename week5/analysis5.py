"""Week 5 go-nuts: does Marvel's Wikipedia copy itself?  (long shared n-grams)

Put week1_nodes.tsv, week1_edges.tsv and marvel_pages.zip next to this file, run:  python analysis5.py
It writes results5.js for week5/index.html.  Needs: pandas networkx.
"""
import json, re, zipfile, urllib.parse, itertools, collections
import pandas as pd, networkx as nx

N = 8            # an n-gram of 8+ tokens is "long"
TEMPLATE = 5     # an n-gram on 5+ pages is template language, not a copy between a few pages
TOP = 60         # pairs kept for the figure

nodes = pd.read_csv("week1_nodes.tsv", sep="\t", comment="#", quoting=3)
edges = pd.read_csv("week1_edges.tsv", sep="\t", comment="#", names=["source", "target"])
with zipfile.ZipFile("marvel_pages.zip") as z:
    pages = {urllib.parse.unquote(n.split("/")[-1][:-4]): z.read(n).decode("utf-8")
             for n in z.namelist() if n.endswith(".txt") and "README" not in n}
ids = [i for i in nodes.node_id if i in pages]
label = lambda i: i.replace("_", " ")
base = lambda i: re.sub(r"\s*\(.*?\)", "", label(i)).strip().lower()   # title without "(Marvel Comics)"
U = nx.Graph(); U.add_nodes_from(ids); U.add_edges_from((a, b) for a, b in edges.itertuples(index=False) if a in pages and b in pages)

# ---------- tokens (lowercase words, apostrophes kept) and their positions in the raw text ----------
spans = {i: [(m.group().lower(), m.start(), m.end()) for m in re.finditer(r"[A-Za-z0-9]+(?:'[A-Za-z]+)?", pages[i])] for i in ids}
gram_at = {i: [tuple(t[0] for t in spans[i][k:k + N]) for k in range(len(spans[i]) - N + 1)] for i in ids}
inv = collections.defaultdict(set)
for i in ids:
    for g in gram_at[i]: inv[g].add(i)
shared = {g: p for g, p in inv.items() if len(p) > 1}
template = {g: p for g, p in shared.items() if len(p) >= TEMPLATE}

# ---------- pairs that share long n-grams between a few pages ----------
pair_n = collections.Counter()
for g, p in shared.items():
    if len(p) < TEMPLATE:
        for a, b in itertools.combinations(sorted(p), 2): pair_n[(a, b)] += 1

def passages(a, b):
    """maximal runs of consecutive shared n-grams = copied passages; returns longest first"""
    pos_b = {g: k for k, g in enumerate(gram_at[b])}
    keep = [k for k, g in enumerate(gram_at[a]) if g in pos_b and len(inv[g]) < TEMPLATE]
    runs, cur = [], []
    for k in keep:
        if cur and k == cur[-1] + 1: cur.append(k)
        else:
            if cur: runs.append(cur)
            cur = [k]
    if cur: runs.append(cur)
    out = []
    for r in sorted(runs, key=len, reverse=True)[:3]:
        L = len(r) + N - 1; ka = r[0]; kb = pos_b[gram_at[a][ka]]
        text = lambda i, k: pages[i][spans[i][k][1]:spans[i][k + L - 1][2]]
        out.append(dict(tokens=L, a=text(a, ka)[:420], b=text(b, kb)[:420]))
    covered = len({k + j for r in runs for k in r for j in range(N)})
    return out, covered

def textkind(t):   # crude, then check by reading: lists of issues/ISBNs vs prose
    digits = sum(c.isdigit() for c in t) / max(1, len(t))
    return "publication list" if re.search(r"ISBN|TPB|Vol\.", t) or digits > .06 else "narrative"

pairs = []
for (a, b), n in pair_n.most_common(TOP):
    ps, covered = passages(a, b)
    d = nx.shortest_path_length(U, a, b) if nx.has_path(U, a, b) else None
    pairs.append(dict(a=label(a), b=label(b), shared=n, longest=ps[0]["tokens"] if ps else 0,
                      cover=round(covered / min(len(spans[a]), len(spans[b])), 3), dist=d,
                      kind="same-name duplicate" if base(a) == base(b) else "different characters",
                      text=textkind(ps[0]["a"]) if ps else "", passages=ps))

# ---------- graph of copying + clusters ----------
H = nx.Graph(); H.add_edges_from((p["a"], p["b"]) for p in pairs)
comps = sorted(nx.connected_components(H), key=len, reverse=True); grp = {n: c for c, cc in enumerate(comps) for n in cc}
words = lambda cc: collections.Counter(w for n in cc for w in re.sub(r"\s*\(.*?\)", "", n).lower().split() if w not in {"the", "of", "man", "woman"})
groups = [dict(label=words(cc).most_common(1)[0][0], n=len(cc)) for cc in comps]
graph = dict(nodes=[dict(id=n, g=grp[n], deg=H.degree(n)) for n in H], groups=groups,
             edges=[dict(a=p["a"], b=p["b"], s=p["shared"], g=grp[p["a"]]) for p in pairs])

# ---------- headline numbers ----------
total = sum(len(s) for s in spans.values())
top_g, top_p = max(template.items(), key=lambda x: len(x[1]))
bucket = collections.Counter(("10+" if len(p) >= 10 else "5-9" if len(p) >= 5 else str(len(p))) for p in shared.values())
tpl_pages = {i for p in template.values() for i in p}
rand = U.number_of_edges() / (len(ids) * (len(ids) - 1) / 2)
stats = dict(pages=len(ids), tokens=total, grams=len(inv), shared=len(shared), template=len(template),
             topPhrase=" ".join(top_g), topPages=len(top_p), templatePages=len(tpl_pages),
             spread=[[k, bucket[k]] for k in ["2", "3", "4", "5-9", "10+"]],
             linked=round(sum(p["dist"] == 1 for p in pairs) / len(pairs), 2), randomLinked=round(rand, 3),
             dup=sum(p["kind"] == "same-name duplicate" for p in pairs), diff=sum(p["kind"] == "different characters" for p in pairs),
             pubs=sum(p["text"] == "publication list" for p in pairs),
             pairsKept=len(pairs), n=N, templateMin=TEMPLATE)
open("results5.js", "w", encoding="utf-8").write("window.R5 = " + json.dumps(dict(stats=stats, pairs=pairs, graph=graph), ensure_ascii=False) + ";")
print(stats)
for p in pairs[:6]: print(p["a"], "|", p["b"], p["shared"], p["longest"], p["cover"], p["dist"], p["kind"], p["text"])
print([g["label"] + str(g["n"]) for g in groups[:8]])
