"""
RQ1 PIPELINE - Biography similarity and community structure

RQ1: To what extent do lexical and semantic representations of musicians'
     Wikipedia biographies produce similar network communities, and what
     biographical themes distinguish those communities?

Input : musicians_final_dataset.csv
Run   : python 3_rq1_pipeline.py                       (uses sentence-transformers)
        python 3_rq1_pipeline.py --embedding lsa       (quick stand-in, NOT truly semantic)

What it builds (three networks, 497 musicians each, same density K):
  lexical          TF-IDF of all words
  lexical_nonames  TF-IDF with proper nouns (people, places, bands) removed
  semantic         sentence-embedding of the biography text

For each network: k-nearest-neighbour graph -> Louvain communities (repeated
with many seeds) -> community profiles (top words) -> centrality measures.

Then it compares the networks (ARI, NMI, permutation baseline, matched
communities, node-level neighbour overlap), checks how much the communities
simply reflect era and country, and tests robustness (different K, without
short biographies).

All results are written to the folder given by --outdir (default rq1_outputs).
"""

import argparse
import os
import re
from collections import Counter

import numpy as np
import pandas as pd
import networkx as nx
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from scipy.optimize import linear_sum_assignment
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import TfidfVectorizer, ENGLISH_STOP_WORDS
from sklearn.metrics import adjusted_rand_score, normalized_mutual_info_score
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.preprocessing import normalize

# ----------------------------------------------------------------------------
# Settings
# ----------------------------------------------------------------------------
parser = argparse.ArgumentParser()
parser.add_argument("--input", default="musicians_final_dataset.csv")
parser.add_argument("--outdir", default="rq1_outputs")
parser.add_argument("--embedding", choices=["sbert", "lsa"], default="sbert")
parser.add_argument("--model", default="all-MiniLM-L6-v2", help="sentence-transformers model name")
parser.add_argument("--chunk-words", type=int, default=150, help="words per chunk for embeddings")
parser.add_argument("--k", type=int, default=10, help="neighbours per musician")
parser.add_argument("--seeds", type=int, default=30, help="Louvain repetitions")
parser.add_argument("--perms", type=int, default=1000, help="permutations for the ARI baseline")
args = parser.parse_args()

K, N_SEEDS, N_PERMS = args.k, args.seeds, args.perms
SENSITIVITY_K = [5, 10, 15, 20]
os.makedirs(args.outdir, exist_ok=True)
out = lambda name: os.path.join(args.outdir, name)
rng = np.random.default_rng(42)

df = pd.read_csv(args.input)
texts = df["article_text_clean"].tolist()
n = len(df)
print(f"Loaded {n} musicians from {args.input}")


# ----------------------------------------------------------------------------
# 1. Text representations
# ----------------------------------------------------------------------------
TOKEN = r"(?u)\b[^\W\d_]{3,}\b"


def find_proper_nouns(texts, min_count=3, share=0.8):
    """Words that are almost always written with a capital letter in the
    middle of a sentence (names of people, places, bands, nationalities, months).
    Simple heuristic, not a full NER; the entity analysis (RQ2) should use real NER."""
    cap_mid, lower = Counter(), Counter()
    for t in texts:
        for m in re.finditer(r"[A-Za-z]+", t):
            w = m.group()
            if len(w) < 3:
                continue
            lw = w.lower()
            if w[0].islower():
                lower[lw] += 1
            else:
                before = t[max(0, m.start() - 3): m.start()].rstrip(" \"'(")
                sentence_start = before == "" or before[-1] in ".!?:\n"
                if not sentence_start:
                    cap_mid[lw] += 1
    return {w for w, c in cap_mid.items()
            if c >= min_count and c / (c + lower[w]) >= share}


def tfidf(texts, extra_stop=frozenset()):
    stops = [w for w in (ENGLISH_STOP_WORDS | set(extra_stop)) if len(w) >= 3]
    vec = TfidfVectorizer(lowercase=True, stop_words=stops, token_pattern=TOKEN,
                          min_df=5, max_df=0.5, sublinear_tf=True)
    X = vec.fit_transform(texts)
    return X, np.array(vec.get_feature_names_out())


def sbert_embeddings(texts, model_name, chunk_words):
    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer(model_name)
    chunks, owner = [], []
    for i, t in enumerate(texts):
        w = t.split()
        for s in range(0, len(w), chunk_words):
            piece = w[s: s + chunk_words]
            if len(piece) >= 30 or s == 0:          # skip tiny tail chunks
                chunks.append(" ".join(piece))
                owner.append(i)
    print(f"Embedding {len(chunks)} text chunks with {model_name} ...")
    E = model.encode(chunks, batch_size=64, show_progress_bar=True, normalize_embeddings=True)
    owner = np.array(owner)
    doc = np.vstack([E[owner == i].mean(axis=0) for i in range(len(texts))])
    return normalize(doc)


proper = find_proper_nouns(texts)
print(f"Proper-noun-like words found: {len(proper)}")

X_lex, terms_lex = tfidf(texts)
X_nn, terms_nn = tfidf(texts, proper)
print(f"Lexical TF-IDF: {X_lex.shape[1]} words | without names: {X_nn.shape[1]} words")

if args.embedding == "sbert":
    emb_file = out("embeddings_sbert.npy")
    if os.path.exists(emb_file):
        EMB = np.load(emb_file)
        print("Loaded saved embeddings")
    else:
        EMB = sbert_embeddings(texts, args.model, args.chunk_words)
        np.save(emb_file, EMB)
    SEM_NAME = f"sentence embeddings ({args.model})"
else:
    print("\n*** WARNING: --embedding lsa is a quick stand-in (reduced TF-IDF), NOT a true "
          "semantic model. Use the default 'sbert' for your real results. ***\n")
    EMB = normalize(TruncatedSVD(n_components=100, random_state=0).fit_transform(X_nn))
    SEM_NAME = "LSA stand-in (not semantic)"

S = {
    "lexical": cosine_similarity(X_lex),
    "lexical_nonames": cosine_similarity(X_nn),
    "semantic": cosine_similarity(EMB),
}
for M in S.values():
    np.fill_diagonal(M, 0)
PREFIX = {"lexical": "lex", "lexical_nonames": "lexnn", "semantic": "sem"}


# ----------------------------------------------------------------------------
# 2. Networks and communities
# ----------------------------------------------------------------------------
def knn_graph(sim, k):
    G = nx.Graph()
    G.add_nodes_from(range(len(sim)))
    for i in range(len(sim)):
        for j in np.argsort(sim[i])[-k:]:
            G.add_edge(i, int(j), weight=float(sim[i, j]))
    return G


def louvain_best(G, seeds):
    runs = []
    for seed in range(seeds):
        comm = nx.community.louvain_communities(G, weight="weight", seed=seed)
        lab = np.zeros(G.number_of_nodes(), dtype=int)
        for c, members in enumerate(comm):
            for m in members:
                lab[m] = c
        runs.append((nx.community.modularity(G, comm, weight="weight"), lab))
    best_mod, best = max(runs, key=lambda r: r[0])
    stability = float(np.mean([adjusted_rand_score(best, r[1]) for r in runs]))
    order = pd.Series(best).value_counts().index.tolist()       # biggest community = 0
    remap = {old: new for new, old in enumerate(order)}
    return np.array([remap[x] for x in best]), best_mod, stability


def centralities(G, labels):
    dist = {(u, v): 1.0 / d["weight"] for u, v, d in G.edges(data=True)}
    nx.set_edge_attributes(G, dist, "distance")
    btw = nx.betweenness_centrality(G, weight="distance")
    deg = dict(G.degree())
    strength = dict(G.degree(weight="weight"))
    part = {}
    for i in G.nodes():                                   # participation coefficient
        k_i = deg[i]
        counts = Counter(labels[j] for j in G.neighbors(i))
        part[i] = 1 - sum((c / k_i) ** 2 for c in counts.values()) if k_i else 0.0
    return pd.DataFrame({"degree": deg, "strength": strength,
                         "betweenness": btw, "participation": part})


def describe(labels, X, terms, n_words=12):
    overall = np.asarray(X.mean(axis=0)).ravel()
    rows = []
    for c in sorted(set(labels)):
        idx = np.where(labels == c)[0]
        diff = np.asarray(X[idx].mean(axis=0)).ravel() - overall
        top = terms[np.argsort(diff)[-n_words:][::-1]]
        sub = df.iloc[idx]
        rows.append({
            "community": c, "size": len(idx),
            "label": ", ".join(top[:3]),
            "top_words": ", ".join(top),
            "median_birthyear": sub["birthyear"].median(),
            "top_countries": ", ".join(f"{k} ({v})" for k, v in sub["bplace_country"].value_counts().head(3).items()),
            "share_female": round((sub["gender"] == "F").mean(), 3),
            "median_hpi": round(sub["hpi_raw"].median(), 2),
            "highest_hpi_members": ", ".join(sub.nlargest(5, "hpi_raw")["name"]),
        })
    return pd.DataFrame(rows)


graphs, labels, quality, profiles, cent = {}, {}, [], {}, {}
for name in S:
    G = knn_graph(S[name], K)
    lab, mod, stab = louvain_best(G, N_SEEDS)
    graphs[name], labels[name] = G, lab
    # describe every partition with the same word list (all-words TF-IDF) so they are comparable
    profiles[name] = describe(lab, X_lex, terms_lex)
    profiles[name].to_csv(out(f"communities_{name}.csv"), index=False)
    cent[name] = centralities(G, lab)
    pd.DataFrame([(df.loc[u, "wp_id"], df.loc[v, "wp_id"], d["weight"]) for u, v, d in G.edges(data=True)],
                 columns=["source_wp_id", "target_wp_id", "similarity"]).to_csv(out(f"edges_{name}.csv"), index=False)
    quality.append({"network": name, "nodes": G.number_of_nodes(), "edges": G.number_of_edges(),
                    "density": round(nx.density(G), 4),
                    "components": nx.number_connected_components(G),
                    "communities": len(set(lab)), "modularity": round(mod, 3),
                    "louvain_stability_ari": round(stab, 2)})
quality = pd.DataFrame(quality)
quality.to_csv(out("network_quality.csv"), index=False)
print("\nNetworks:\n" + quality.to_string(index=False))


# ----------------------------------------------------------------------------
# 3. Comparing the networks
# ----------------------------------------------------------------------------
def compare(a, b, perms=N_PERMS):
    obs = adjusted_rand_score(a, b)
    base = np.array([adjusted_rand_score(a, rng.permutation(b)) for _ in range(perms)])
    return {"ARI": round(obs, 3), "NMI": round(normalized_mutual_info_score(a, b), 3),
            "ARI_chance_mean": round(base.mean(), 4),
            "permutation_p": round((np.sum(base >= obs) + 1) / (perms + 1), 4)}


def edge_overlap(G1, G2):
    e1 = {frozenset(e) for e in G1.edges()}
    e2 = {frozenset(e) for e in G2.edges()}
    return round(len(e1 & e2) / len(e1 | e2), 3)


def matched_pairs(a, b):
    """Pair every community of a with its best-overlapping community of b (Hungarian)."""
    cont = pd.crosstab(a, b)
    r, c = linear_sum_assignment(-cont.values)
    return {(cont.index[i], cont.columns[j]) for i, j in zip(r, c)}


def neighbour_overlap(S1, S2, k):
    res = []
    for i in range(len(S1)):
        a = set(np.argsort(S1[i])[-k:])
        b = set(np.argsort(S2[i])[-k:])
        res.append(len(a & b) / len(a | b))
    return np.array(res)


PAIRS = [("lexical", "semantic"), ("lexical_nonames", "semantic"), ("lexical", "lexical_nonames")]
comp_rows = []
for a, b in PAIRS:
    row = {"network_A": a, "network_B": b}
    row.update(compare(labels[a], labels[b]))
    row["edge_jaccard"] = edge_overlap(graphs[a], graphs[b])
    row["mean_neighbour_jaccard"] = round(neighbour_overlap(S[a], S[b], K).mean(), 3)
    comp_rows.append(row)
comp = pd.DataFrame(comp_rows)
comp.to_csv(out("comparison_summary.csv"), index=False)
print("\nComparison of partitions:\n" + comp.to_string(index=False))

# contingency table: lexical vs semantic
cont = pd.crosstab(pd.Series(labels["lexical"], name="lexical community"),
                   pd.Series(labels["semantic"], name="semantic community"))
cont.to_csv(out("contingency_lexical_vs_semantic.csv"))

# musicians placed differently by the two representations
pairs = matched_pairs(labels["lexical"], labels["semantic"])
nb = neighbour_overlap(S["lexical"], S["semantic"], K)
mismatch = np.array([(l, s) not in pairs for l, s in zip(labels["lexical"], labels["semantic"])])
print(f"\nMusicians placed in non-matching communities (lexical vs semantic): "
      f"{mismatch.sum()} of {n} ({mismatch.mean():.1%})")

# how much do communities just reflect era and country?
era = pd.cut(df["birthyear"], [0, 1800, 1900, 1930, 1950, 1970, 2100],
             labels=["<1800", "1800-1899", "1900-1929", "1930-1949", "1950-1969", "1970+"])
era = era.astype(object).where(era.notna(), "Unknown").astype(str)
top_countries = df["bplace_country"].value_counts().head(8).index
country = df["bplace_country"].where(df["bplace_country"].isin(top_countries), "Other").fillna("Other").astype(str)
conf_rows = []
for name in S:
    conf_rows.append({"network": name,
                      "NMI_with_era": round(normalized_mutual_info_score(labels[name], era), 3),
                      "NMI_with_country": round(normalized_mutual_info_score(labels[name], country), 3)})
conf = pd.DataFrame(conf_rows)
conf.to_csv(out("communities_vs_era_country.csv"), index=False)
print("\nHow much communities reflect era / country (NMI, 0-1):\n" + conf.to_string(index=False))

# robustness 1: without the short biographies
keep = ~df["short_bio"].values
rob_short = {"ARI_lex_vs_sem_all": float(comp.loc[0, "ARI"]),
             "ARI_lex_vs_sem_without_short_bios": round(adjusted_rand_score(labels["lexical"][keep], labels["semantic"][keep]), 3),
             "n_without_short_bios": int(keep.sum())}
pd.DataFrame([rob_short]).to_csv(out("robustness_short_bios.csv"), index=False)
print("\nRobustness, without short biographies:", rob_short)

# robustness 2: different numbers of neighbours (K)
sens = []
for k in SENSITIVITY_K:
    labs = {}
    for name in S:
        G = knn_graph(S[name], k)
        lab, mod, _ = louvain_best(G, 10)
        labs[name] = lab
        sens.append({"K": k, "network": name, "communities": len(set(lab)), "modularity": round(mod, 3)})
    sens.append({"K": k, "network": "ARI lexical vs semantic",
                 "communities": "", "modularity": round(adjusted_rand_score(labs["lexical"], labs["semantic"]), 3)})
    sens.append({"K": k, "network": "ARI lexical_nonames vs semantic",
                 "communities": "", "modularity": round(adjusted_rand_score(labs["lexical_nonames"], labs["semantic"]), 3)})
sens = pd.DataFrame(sens).rename(columns={"modularity": "modularity_or_ARI"})
sens.to_csv(out("robustness_k.csv"), index=False)
print("\nRobustness to K:\n" + sens.to_string(index=False))


# ----------------------------------------------------------------------------
# 4. Node table (share this with the RQ2 / RQ3 teammates)
# ----------------------------------------------------------------------------
nodes = df[["wp_id", "name", "hpi_raw"]].copy()
for name, p in PREFIX.items():
    nodes[f"{p}_community"] = labels[name]
    nodes[f"{p}_community_label"] = [profiles[name].loc[c, "label"] for c in labels[name]]
    for col in ["degree", "strength", "betweenness", "participation"]:
        nodes[f"{p}_{col}"] = cent[name][col].values
nodes["neighbour_jaccard_lex_sem"] = nb.round(3)
nodes["mismatch_lex_sem"] = mismatch
nodes.to_csv(out("rq1_nodes.csv"), index=False)
nodes[nodes["mismatch_lex_sem"]].sort_values("neighbour_jaccard_lex_sem")[
    ["wp_id", "name", "hpi_raw", "lex_community", "lex_community_label",
     "sem_community", "sem_community_label", "neighbour_jaccard_lex_sem"]
].to_csv(out("rq1_disagreements.csv"), index=False)


# ----------------------------------------------------------------------------
# 5. Figures
# ----------------------------------------------------------------------------
fig, axes = plt.subplots(1, 2, figsize=(18, 8))
for ax, name, title in zip(axes, ["lexical", "semantic"],
                           ["Lexical (TF-IDF)", f"Semantic ({SEM_NAME})"]):
    G = graphs[name]
    pos = nx.spring_layout(G, weight="weight", seed=1, k=0.25, iterations=200)
    nx.draw_networkx_edges(G, pos, alpha=0.07, width=0.5, ax=ax)
    nx.draw_networkx_nodes(G, pos, node_color=plt.cm.tab20(labels[name] % 20), node_size=22, ax=ax)
    ax.set_title(f"{title}\n{len(set(labels[name]))} communities, k={K}")
    ax.axis("off")
plt.tight_layout()
plt.savefig(out("networks_side_by_side.png"), dpi=150)
plt.close()

fig, ax = plt.subplots(figsize=(8, 6))
im = ax.imshow(cont.values, cmap="Blues")
ax.set_xticks(range(cont.shape[1]))
ax.set_yticks(range(cont.shape[0]))
ax.set_xticklabels([f"S{c}\n{profiles['semantic'].loc[c, 'label'][:22]}" for c in cont.columns], fontsize=7)
ax.set_yticklabels([f"L{c}: {profiles['lexical'].loc[c, 'label'][:26]}" for c in cont.index], fontsize=7)
for i in range(cont.shape[0]):
    for j in range(cont.shape[1]):
        ax.text(j, i, cont.values[i, j], ha="center", va="center", fontsize=8,
                color="white" if cont.values[i, j] > cont.values.max() / 2 else "black")
ax.set_xlabel("Semantic community")
ax.set_ylabel("Lexical community")
ax.set_title("How lexical communities map onto semantic communities")
plt.colorbar(im)
plt.tight_layout()
plt.savefig(out("contingency_lexical_vs_semantic.png"), dpi=150)
plt.close()

with open(out("README_outputs.txt"), "w") as f:
    f.write(f"""RQ1 outputs (embedding: {SEM_NAME}, K={K}, seeds={N_SEEDS})

rq1_nodes.csv                      one row per musician: community + degree, strength,
                                   betweenness, participation (bridging) in each network
                                   (lex_ = lexical, lexnn_ = lexical without names, sem_ = semantic)
                                   plus neighbour_jaccard_lex_sem and mismatch_lex_sem
edges_*.csv                        network edges (source_wp_id, target_wp_id, similarity)
communities_*.csv                  size and top words / countries / HPI of each community
network_quality.csv                nodes, edges, density, modularity, Louvain stability
comparison_summary.csv             ARI / NMI between networks vs permutation baseline
contingency_lexical_vs_semantic.*  table and heatmap
rq1_disagreements.csv              musicians placed differently by lexical vs semantic
communities_vs_era_country.csv     how much communities just mirror era and country
robustness_short_bios.csv, robustness_k.csv
networks_side_by_side.png
""")
print(f"\nDone. All outputs are in the folder: {args.outdir}/")
