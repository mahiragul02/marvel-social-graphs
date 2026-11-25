"""
RQ2 PIPELINE - Shared named entities and network bridges

RQ2: How do networks based on shared named entities in musicians' biographies
     differ from networks based on textual similarity, and which musicians
     bridge otherwise distinct groups?

Input : data/musicians_final_dataset.csv
        rq2/entities_clean.csv, rq2/entity_vocabulary.csv   (from 4_rq2_extract_entities.py)
        rq1/rq1_nodes.csv, rq1/edges_*.csv                  (from 3_rq1_pipeline.py)
Run   : python 5_rq2_pipeline.py

What it does
  1. Entity networks. Musician x entity matrix, TF-IDF weighted so that very
     common entities ("United States", "Grammy Award") count little. Cosine
     similarity, then the same k-nearest-neighbour graph (K=10) and Louvain set-up
     as RQ1, so the networks can be compared directly.
     One network with all entity types, plus one per type (people, organisations,
     places, works + events), to see which kind of entity drives the structure.
  2. Comparison with the RQ1 text networks (lexical, lexical without names,
     semantic): ARI / NMI against a permutation baseline, edge overlap against
     chance, neighbour overlap per musician, contingency table, and how much each
     partition just reflects era and country.
  3. Bridges. For every musician in the entity network: betweenness, and how its
     links are spread over the SEMANTIC communities of RQ1 (participation
     coefficient and the share of link weight going to other semantic communities).
     A bridge is a musician who links, through shared entities, groups that
     textual similarity keeps apart. For the top bridges, the shared entities
     behind each cross-group link are listed.
  4. Bridging entities: entities whose musicians are spread across many semantic
     communities.
  5. Direct mention network: A's biography names musician B (another top-500 musician).
  6. Robustness: K, minimum document frequency, without short biographies,
     biography length.

All results are written to --outdir (default rq2/).
"""

import argparse
import os
import re
import unicodedata
from collections import Counter, defaultdict

import numpy as np
import pandas as pd
import networkx as nx
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from scipy import sparse
from scipy.optimize import linear_sum_assignment
from scipy.stats import spearmanr
from sklearn.feature_extraction.text import TfidfTransformer
from sklearn.metrics import adjusted_rand_score, normalized_mutual_info_score
from sklearn.metrics.pairwise import cosine_similarity

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ----------------------------------------------------------------------------
# Settings
# ----------------------------------------------------------------------------
parser = argparse.ArgumentParser()
parser.add_argument("--input", default=os.path.join(BASE, "data", "musicians_final_dataset.csv"))
parser.add_argument("--entities", default=os.path.join(BASE, "rq2", "entities_clean.csv"))
parser.add_argument("--vocabulary", default=os.path.join(BASE, "rq2", "entity_vocabulary.csv"))
parser.add_argument("--rq1dir", default=os.path.join(BASE, "rq1"))
parser.add_argument("--outdir", default=os.path.join(BASE, "rq2"))
parser.add_argument("--k", type=int, default=10, help="neighbours per musician (RQ1 used 10)")
parser.add_argument("--seeds", type=int, default=30, help="Louvain repetitions")
parser.add_argument("--perms", type=int, default=1000, help="permutations for the ARI baseline")
parser.add_argument("--min-df", type=int, default=2, help="entity must appear in at least this many biographies")
parser.add_argument("--max-df", type=float, default=0.5, help="drop entities in more than this share of biographies")
parser.add_argument("--types", nargs="+", default=["PERSON", "ORG", "PLACE", "WORK", "EVENT"])
parser.add_argument("--top", type=int, default=25, help="number of bridges to report")
args = parser.parse_args()

K, N_SEEDS, N_PERMS, TOP = args.k, args.seeds, args.perms, args.top
SENSITIVITY_K = [5, 10, 15, 20]
SENSITIVITY_MIN_DF = [2, 3, 5]
os.makedirs(args.outdir, exist_ok=True)
out = lambda name: os.path.join(args.outdir, name)
rng = np.random.default_rng(42)

# ----------------------------------------------------------------------------
# 0. Load data
# ----------------------------------------------------------------------------
df = pd.read_csv(args.input)
n = len(df)
row_of = {w: i for i, w in enumerate(df["wp_id"])}
NAMES = df["name"].to_numpy()

ents = pd.read_csv(args.entities, keep_default_na=False)
ents = ents[ents["wp_id"].isin(row_of) & ents["type"].isin(args.types)].copy()
voc = pd.read_csv(args.vocabulary, keep_default_na=False)
DISPLAY = dict(zip(voc["entity_key"], voc["entity"]))
ETYPE = dict(zip(voc["entity_key"], voc["type"]))
print(f"Loaded {n} musicians, {len(ents)} musician-entity pairs, "
      f"{ents['entity_key'].nunique()} distinct entities ({', '.join(args.types)})")

rq1 = pd.read_csv(os.path.join(args.rq1dir, "rq1_nodes.csv"))
missing = set(df["wp_id"]) - set(rq1["wp_id"])
if missing:
    raise SystemExit(f"{len(missing)} musicians are missing from rq1_nodes.csv - rerun RQ1 first")
rq1 = rq1.set_index("wp_id").loc[df["wp_id"]].reset_index()

TEXT_NETS = {"lexical": "lex", "lexical_nonames": "lexnn", "semantic": "sem"}
text_labels, text_label_names, text_graphs = {}, {}, {}
for name, p in TEXT_NETS.items():
    text_labels[name] = rq1[f"{p}_community"].to_numpy()
    text_label_names[name] = dict(zip(rq1[f"{p}_community"], rq1[f"{p}_community_label"]))
    e = pd.read_csv(os.path.join(args.rq1dir, f"edges_{name}.csv"))
    G = nx.Graph()
    G.add_nodes_from(range(n))
    for s, t, w in e[["source_wp_id", "target_wp_id", "similarity"]].itertuples(index=False):
        G.add_edge(row_of[s], row_of[t], weight=float(w))
    text_graphs[name] = G
SEM = text_labels["semantic"]
SEM_LABEL = {c: f"S{c}: {l}" for c, l in text_label_names["semantic"].items()}


# ----------------------------------------------------------------------------
# 1. Entity matrices and networks
# ----------------------------------------------------------------------------
def entity_matrix(types, min_df=args.min_df, max_df=args.max_df):
    sub = ents[ents["type"].isin(types)]
    dfreq = sub.groupby("entity_key")["wp_id"].nunique()
    keep = dfreq[(dfreq >= min_df) & (dfreq <= max_df * n)].index
    sub = sub[sub["entity_key"].isin(keep)]
    vocab = np.array(sorted(keep))
    col = {k: j for j, k in enumerate(vocab)}
    C = sparse.csr_matrix((sub["count"].astype(float).to_numpy(),
                           (sub["wp_id"].map(row_of).to_numpy(), sub["entity_key"].map(col).to_numpy())),
                          shape=(n, len(vocab)))
    X = TfidfTransformer(sublinear_tf=True).fit_transform(C) if len(vocab) else C
    return sparse.csr_matrix(X), vocab


def similarity(X):
    S = cosine_similarity(X)
    np.fill_diagonal(S, 0)
    return S


def knn_graph(sim, k):
    """Same as RQ1, except that zero-similarity pairs are not linked
    (a musician with no shared entity stays isolated instead of getting random links)."""
    G = nx.Graph()
    G.add_nodes_from(range(len(sim)))
    for i in range(len(sim)):
        for j in np.argsort(sim[i])[-k:]:
            if sim[i, j] > 0:
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
    for i in G.nodes():                                   # participation coefficient (as RQ1)
        k_i = deg[i]
        counts = Counter(labels[j] for j in G.neighbors(i))
        part[i] = 1 - sum((c / k_i) ** 2 for c in counts.values()) if k_i else 0.0
    return pd.DataFrame({"degree": deg, "strength": strength,
                         "betweenness": btw, "participation": part}).sort_index()


def describe(labels, X, vocab, n_top=12):
    overall = np.asarray(X.mean(axis=0)).ravel()
    rows = []
    for c in sorted(set(labels)):
        idx = np.where(labels == c)[0]
        diff = np.asarray(X[idx].mean(axis=0)).ravel() - overall
        top = [DISPLAY.get(k, k) for k in vocab[np.argsort(diff)[-n_top:][::-1]]]
        sub = df.iloc[idx]
        sem_c = Counter(SEM[idx]).most_common(1)[0]
        rows.append({
            "community": c, "size": len(idx),
            "label": ", ".join(top[:3]),
            "top_entities": ", ".join(top),
            "main_semantic_community": SEM_LABEL[sem_c[0]],
            "share_in_main_semantic_community": round(sem_c[1] / len(idx), 3),
            "median_birthyear": sub["birthyear"].median(),
            "top_countries": ", ".join(f"{k} ({v})" for k, v in sub["bplace_country"].value_counts().head(3).items()),
            "share_female": round((sub["gender"] == "F").mean(), 3),
            "median_hpi": round(sub["hpi_raw"].median(), 2),
            "highest_hpi_members": ", ".join(sub.nlargest(5, "hpi_raw")["name"]),
        })
    return pd.DataFrame(rows)


TYPE_SETS = {"entity_all": args.types,
             "entity_person": ["PERSON"],
             "entity_org": ["ORG"],
             "entity_place": ["PLACE"],
             "entity_work_event": ["WORK", "EVENT"]}
TYPE_SETS = {k: [t for t in v if t in args.types] for k, v in TYPE_SETS.items()}
TYPE_SETS = {k: v for k, v in TYPE_SETS.items() if v}

mats, S, graphs, labels, profiles, cent, quality = {}, {}, {}, {}, {}, {}, []
for name, types in TYPE_SETS.items():
    X, vocab = entity_matrix(types)
    if X.shape[1] == 0:
        print(f"[skip] {name}: no entity left after the min/max document frequency filter")
        continue
    mats[name] = (X, vocab)
    S[name] = similarity(X)
    G = knn_graph(S[name], K)
    lab, mod, stab = louvain_best(G, N_SEEDS)
    graphs[name], labels[name] = G, lab
    profiles[name] = describe(lab, X, vocab)
    profiles[name].to_csv(out(f"communities_{name}.csv"), index=False)
    cent[name] = centralities(G, lab)
    pd.DataFrame([(df.loc[u, "wp_id"], df.loc[v, "wp_id"], d["weight"]) for u, v, d in G.edges(data=True)],
                 columns=["source_wp_id", "target_wp_id", "similarity"]).to_csv(out(f"edges_{name}.csv"), index=False)
    sizes = pd.Series(lab).value_counts()
    quality.append({"network": name, "entity_types": "+".join(types), "entities_used": X.shape[1],
                    "musicians_without_entities": int((X.getnnz(axis=1) == 0).sum()),
                    "nodes": G.number_of_nodes(), "edges": G.number_of_edges(),
                    "density": round(nx.density(G), 4),
                    "isolates": nx.number_of_isolates(G),
                    "components": nx.number_connected_components(G),
                    "communities": len(sizes), "communities_size_5plus": int((sizes >= 5).sum()),
                    "modularity": round(mod, 3), "louvain_stability_ari": round(stab, 2)})
for name, G in text_graphs.items():                       # RQ1 networks, for reference
    quality.append({"network": f"{name} (RQ1)", "nodes": G.number_of_nodes(), "edges": G.number_of_edges(),
                    "density": round(nx.density(G), 4), "isolates": nx.number_of_isolates(G),
                    "components": nx.number_connected_components(G),
                    "communities": len(set(text_labels[name])),
                    "modularity": round(nx.community.modularity(
                        G, [set(np.where(text_labels[name] == c)[0]) for c in set(text_labels[name])]), 3)})
quality = pd.DataFrame(quality)
quality.to_csv(out("network_quality.csv"), index=False)
print("\nNetworks:\n" + quality.to_string(index=False))

MAIN = "entity_all"
if MAIN not in graphs:
    raise SystemExit("The all-entities network could not be built - check entities_clean.csv")


# ----------------------------------------------------------------------------
# 2. Entity networks vs text networks
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
    obs = len(e1 & e2) / len(e1 | e2)
    M = n * (n - 1) / 2                               # expected Jaccard of two random graphs
    exp_inter = len(e1) * len(e2) / M
    exp = exp_inter / (len(e1) + len(e2) - exp_inter)
    return round(obs, 3), round(exp, 4), int(len(e1 & e2))


def neighbour_jaccard(G1, G2):
    res = np.full(n, np.nan)
    for i in range(n):
        a, b = set(G1.neighbors(i)), set(G2.neighbors(i))
        if a or b:
            res[i] = len(a & b) / len(a | b)
    return res


def matched_pairs(a, b):
    cont = pd.crosstab(a, b)
    r, c = linear_sum_assignment(-cont.values)
    return {(cont.index[i], cont.columns[j]) for i, j in zip(r, c)}


ALL_G = {**graphs, **text_graphs}
ALL_L = {**labels, **text_labels}
PAIRS = [(e, t) for e in graphs for t in text_graphs]                    # entity vs text
PAIRS += [(MAIN, e) for e in graphs if e != MAIN]                        # all vs single type
PAIRS += [("lexical", "semantic"), ("lexical_nonames", "semantic"), ("lexical", "lexical_nonames")]  # RQ1 reference
comp_rows = []
for a, b in PAIRS:
    row = {"network_A": a, "network_B": b}
    row.update(compare(ALL_L[a], ALL_L[b]))
    row["edge_jaccard"], row["edge_jaccard_chance"], row["shared_edges"] = edge_overlap(ALL_G[a], ALL_G[b])
    row["mean_neighbour_jaccard"] = round(np.nanmean(neighbour_jaccard(ALL_G[a], ALL_G[b])), 3)
    comp_rows.append(row)
comp = pd.DataFrame(comp_rows)
comp.to_csv(out("comparison_summary.csv"), index=False)
print("\nEntity networks vs text networks:\n" + comp.to_string(index=False))

cont = pd.crosstab(pd.Series(labels[MAIN], name="entity community"),
                   pd.Series(SEM, name="semantic community"))
cont.to_csv(out("contingency_entity_vs_semantic.csv"))

# era / country (same bins as RQ1)
era = pd.cut(df["birthyear"], [0, 1800, 1900, 1930, 1950, 1970, 2100],
             labels=["<1800", "1800-1899", "1900-1929", "1930-1949", "1950-1969", "1970+"])
era = era.astype(object).where(era.notna(), "Unknown").astype(str)
top_countries = df["bplace_country"].value_counts().head(8).index
country = df["bplace_country"].where(df["bplace_country"].isin(top_countries), "Other").fillna("Other").astype(str)
conf = pd.DataFrame([{"network": name,
                      "NMI_with_era": round(normalized_mutual_info_score(ALL_L[name], era), 3),
                      "NMI_with_country": round(normalized_mutual_info_score(ALL_L[name], country), 3)}
                     for name in ALL_L])
conf.to_csv(out("communities_vs_era_country.csv"), index=False)
print("\nHow much communities reflect era / country (NMI, 0-1):\n" + conf.to_string(index=False))


# ----------------------------------------------------------------------------
# 3. Bridges
# ----------------------------------------------------------------------------
SEM_SIZE = pd.Series(SEM).value_counts()


def cross_group_stats(G, groups):
    """How the links of each musician are spread over `groups` (RQ1 semantic communities)."""
    rows = []
    for i in range(n):
        nb = list(G.neighbors(i))
        if not nb:
            rows.append({"cross_share": np.nan, "participation_groups": np.nan, "groups_reached": 0})
            continue
        w = np.array([G[i][j]["weight"] for j in nb])
        by = defaultdict(float)
        for j, wj in zip(nb, w):
            by[groups[j]] += wj
        W = w.sum()
        rows.append({"cross_share": sum(v for c, v in by.items() if c != groups[i]) / W,
                     "participation_groups": 1 - sum((v / W) ** 2 for v in by.values()),
                     "groups_reached": sum(1 for c in by if c != groups[i])})
    return pd.DataFrame(rows)


def bridge_table(G, ent_labels):
    c = centralities(G, ent_labels)
    x = cross_group_stats(G, SEM)
    t = pd.concat([c.reset_index(drop=True), x], axis=1)
    has = t["degree"] > 0
    t["bridge_score"] = np.nan
    t.loc[has, "bridge_score"] = (t.loc[has, "betweenness"].rank(pct=True) +
                                  t.loc[has, "participation_groups"].rank(pct=True)) / 2
    return t


br = bridge_table(graphs[MAIN], labels[MAIN])
sem_x = cross_group_stats(text_graphs["semantic"], SEM)        # same measure inside the semantic network
br["cross_share_in_semantic_net"] = sem_x["cross_share"]
br["extra_cross_share"] = br["cross_share"] - br["cross_share_in_semantic_net"]
br["expected_cross_share_random"] = [1 - (SEM_SIZE[s] - 1) / (n - 1) for s in SEM]

# length control: residual of the bridge score on log biography length
has = br["bridge_score"].notna().to_numpy()
L = df["log_clean_words"].to_numpy()
beta = np.polyfit(L[has], br.loc[has, "bridge_score"], 1)
br["bridge_score_length_adj"] = np.nan
br.loc[has, "bridge_score_length_adj"] = br.loc[has, "bridge_score"] - np.polyval(beta, L[has])
br["bridge_rank"] = br["bridge_score"].rank(ascending=False, method="min")
br["bridge_rank_length_adj"] = br["bridge_score_length_adj"].rank(ascending=False, method="min")

XM, VM = mats[MAIN]


def shared_entities(i, j, top=6):
    prod = XM[i].multiply(XM[j]).tocoo()
    order = np.argsort(prod.data)[::-1][:top]
    return [DISPLAY.get(VM[prod.col[k]], VM[prod.col[k]]) for k in order]


G_main = graphs[MAIN]
top_idx = br["bridge_score"].sort_values(ascending=False).index[:TOP]
top_rows, expl_rows = [], []
for i in top_idx:
    cross_nb = [j for j in G_main.neighbors(i) if SEM[j] != SEM[i]]
    ent_weight = Counter()
    for j in cross_nb:
        prod = XM[i].multiply(XM[j]).tocoo()
        for cidx, v in zip(prod.col, prod.data):
            ent_weight[DISPLAY.get(VM[cidx], VM[cidx])] += v
        expl_rows.append({"bridge": NAMES[i], "bridge_semantic_community": SEM_LABEL[SEM[i]],
                          "neighbour": NAMES[j], "neighbour_semantic_community": SEM_LABEL[SEM[j]],
                          "entity_similarity": round(G_main[i][j]["weight"], 3),
                          "shared_entities": ", ".join(shared_entities(i, j))})
    reached = Counter(SEM_LABEL[SEM[j]] for j in cross_nb)
    r = br.loc[i]
    top_rows.append({
        "rank": int(r["bridge_rank"]), "wp_id": df.loc[i, "wp_id"], "name": NAMES[i],
        "semantic_community": SEM_LABEL[SEM[i]],
        "entity_community": f"E{labels[MAIN][i]}: {profiles[MAIN].loc[labels[MAIN][i], 'label']}",
        "bridge_score": round(r["bridge_score"], 3),
        "rank_length_adjusted": int(r["bridge_rank_length_adj"]),
        "betweenness": round(r["betweenness"], 4),
        "cross_share": round(r["cross_share"], 3),
        "cross_share_in_semantic_net": round(r["cross_share_in_semantic_net"], 3),
        "semantic_groups_reached": int(r["groups_reached"]),
        "groups_reached": "; ".join(f"{k} ({v})" for k, v in reached.most_common()),
        "bridging_entities": ", ".join(e for e, _ in ent_weight.most_common(8)),
        "cross_neighbours": ", ".join(NAMES[j] for j in sorted(cross_nb, key=lambda j: -G_main[i][j]["weight"])[:6]),
        "clean_words": df.loc[i, "clean_words"], "hpi_raw": round(df.loc[i, "hpi_raw"], 2),
    })
top_bridges = pd.DataFrame(top_rows)
top_bridges.to_csv(out("rq2_top_bridges.csv"), index=False)
pd.DataFrame(expl_rows).to_csv(out("rq2_bridge_explanations.csv"), index=False)
print(f"\nTop {TOP} bridges (entity links across semantic communities):\n" +
      top_bridges[["rank", "name", "semantic_community", "semantic_groups_reached",
                   "cross_share", "rank_length_adjusted", "bridging_entities"]].head(15).to_string(index=False))

# hidden bridges: firmly inside one group by text, spread out by entities
hidden = br[(br["cross_share_in_semantic_net"] <= 0.2) & br["cross_share"].notna()] \
    .sort_values("extra_cross_share", ascending=False).head(TOP)
pd.DataFrame({"name": NAMES[hidden.index], "semantic_community": [SEM_LABEL[SEM[i]] for i in hidden.index],
              "cross_share_in_semantic_net": hidden["cross_share_in_semantic_net"].round(3).to_numpy(),
              "cross_share_in_entity_net": hidden["cross_share"].round(3).to_numpy(),
              "bridging_entities": [", ".join(e for e, _ in Counter(
                  {DISPLAY.get(VM[c], VM[c]): v for j in G_main.neighbors(i) if SEM[j] != SEM[i]
                   for c, v in zip(XM[i].multiply(XM[j]).tocoo().col, XM[i].multiply(XM[j]).tocoo().data)}
              ).most_common(6)) for i in hidden.index]}).to_csv(out("rq2_hidden_bridges.csv"), index=False)

# what are bridges like? (correlations with length, fame, number of entities)
n_ent = np.asarray((XM > 0).sum(axis=1)).ravel()
corr_rows = []
for col, vals in [("log_clean_words", df["log_clean_words"]), ("hpi_raw", df["hpi_raw"]),
                  ("birthyear", df["birthyear"]), ("n_entities_used", pd.Series(n_ent))]:
    m = has & vals.notna().to_numpy()
    rho, p = spearmanr(br.loc[m, "bridge_score"], vals[m])
    corr_rows.append({"variable": col, "spearman_rho_with_bridge_score": round(rho, 3), "p": round(p, 4)})
corr = pd.DataFrame(corr_rows)
corr.to_csv(out("bridge_correlates.csv"), index=False)
print("\nBridge score vs musician characteristics:\n" + corr.to_string(index=False))


# ----------------------------------------------------------------------------
# 4. Bridging entities
# ----------------------------------------------------------------------------
B = (XM > 0).tocsc()
n_groups = len(SEM_SIZE)
ent_rows = []
for j in range(B.shape[1]):
    holders = B[:, j].indices
    if len(holders) < 3:
        continue
    cnt = Counter(SEM[holders])
    p = np.array(list(cnt.values())) / len(holders)
    ent_rows.append({"entity": DISPLAY.get(VM[j], VM[j]), "type": ETYPE.get(VM[j], ""),
                     "n_musicians": len(holders), "semantic_communities": len(cnt),
                     "spread_entropy": round(float(-(p * np.log(p)).sum() / np.log(n_groups)), 3),
                     "distribution": "; ".join(f"{SEM_LABEL[c]} ({v})" for c, v in cnt.most_common()),
                     "example_musicians": ", ".join(NAMES[holders[np.argsort(-df['hpi_raw'].to_numpy()[holders])][:5]])})
ent_bridge = pd.DataFrame(ent_rows).sort_values(["spread_entropy", "n_musicians"], ascending=False)
ent_bridge.to_csv(out("rq2_bridging_entities.csv"), index=False)
print("\nEntities spread most evenly over the semantic communities:\n" +
      ent_bridge.head(15)[["entity", "type", "n_musicians", "semantic_communities", "spread_entropy"]].to_string(index=False))


# ----------------------------------------------------------------------------
# 5. Direct mention network (A's biography names musician B)
# ----------------------------------------------------------------------------
def strip_accents(s):
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def norm_key(text):            # must stay identical to 4_rq2_extract_entities.py
    s = strip_accents(str(text)).replace("’", "'").replace("‘", "'")
    s = s.replace("“", '"').replace("”", '"').replace("\n", " ").strip().strip("\"'")
    s = re.sub(r"'s?$", "", s)
    s = re.sub(r"^the\s+", "", s, flags=re.I)
    s = s.lower()
    s = re.sub(r"\.(?=\w)", "", s)
    s = re.sub(r"[^\w\s&'-]", " ", s)
    return re.sub(r"\s+", " ", s).strip(" -'")


key_rows = defaultdict(list)
for i, nm in enumerate(NAMES):
    key_rows[norm_key(re.sub(r"\s*\(.*?\)\s*", " ", nm))].append(i)
unique_key = {k: v[0] for k, v in key_rows.items() if len(v) == 1}     # skip the two Marilyn Mansons

all_ents = pd.read_csv(args.entities, keep_default_na=False)
men = all_ents[all_ents["type"].isin(["PERSON", "ORG"]) & all_ents["entity_key"].isin(unique_key)
               & all_ents["wp_id"].isin(row_of)]
DG = nx.DiGraph()
DG.add_nodes_from(range(n))
for wp, key, c in men[["wp_id", "entity_key", "count"]].itertuples(index=False):
    a, b = row_of[wp], unique_key[key]
    if a != b:
        DG.add_edge(a, b, count=int(c))
edge_sets = {name: {frozenset(e) for e in ALL_G[name].edges()} for name in [MAIN, "semantic", "lexical", "lexical_nonames"]}
m_rows = [{"source_wp_id": df.loc[a, "wp_id"], "source": NAMES[a],
           "target_wp_id": df.loc[b, "wp_id"], "target": NAMES[b], "mentions": d["count"],
           "same_semantic_community": bool(SEM[a] == SEM[b]),
           **{f"also_edge_in_{k}": frozenset((a, b)) in v for k, v in edge_sets.items()}}
          for a, b, d in DG.edges(data=True)]
mentions = pd.DataFrame(m_rows)
mentions.to_csv(out("edges_mentions.csv"), index=False)
if len(mentions):
    msum = {"mention_edges": len(mentions),
            "musicians_mentioning_another": int((np.array([d for _, d in DG.out_degree()]) > 0).sum()),
            "musicians_mentioned": int((np.array([d for _, d in DG.in_degree()]) > 0).sum()),
            "reciprocity": round(nx.reciprocity(DG), 3),
            "share_across_semantic_communities": round(float(1 - mentions["same_semantic_community"].mean()), 3),
            "share_across_expected_random": round(float(1 - ((SEM_SIZE / n) ** 2).sum()), 3),
            **{f"share_also_edge_in_{k}": round(float(mentions[f"also_edge_in_{k}"].mean()), 3) for k in edge_sets}}
else:
    msum = {"mention_edges": 0}
pd.DataFrame([msum]).to_csv(out("mentions_summary.csv"), index=False)
print("\nDirect mentions between top-500 musicians:", msum)


# ----------------------------------------------------------------------------
# 6. Robustness
# ----------------------------------------------------------------------------
top_set = set(top_idx)


def top_overlap(score):
    return len(set(score.sort_values(ascending=False).index[:TOP]) & top_set) / TOP


rob = []
for k in SENSITIVITY_K:
    Gk = knn_graph(S[MAIN], k)
    labk, modk, _ = louvain_best(Gk, 10)
    bk = bridge_table(Gk, labk)["bridge_score"]
    m = bk.notna() & br["bridge_score"].notna()
    rob.append({"check": f"K={k}", "communities": len(set(labk)), "modularity": round(modk, 3),
                "ARI_vs_semantic": round(adjusted_rand_score(labk, SEM), 3),
                "ARI_vs_lexical_nonames": round(adjusted_rand_score(labk, text_labels["lexical_nonames"]), 3),
                "bridge_score_spearman_vs_main": round(spearmanr(bk[m], br.loc[m, "bridge_score"])[0], 3),
                f"top{TOP}_bridge_overlap": round(top_overlap(bk), 2)})
for md in SENSITIVITY_MIN_DF:
    Xd, _ = entity_matrix(args.types, min_df=md)
    Gd = knn_graph(similarity(Xd), K)
    labd, modd, _ = louvain_best(Gd, 10)
    bd = bridge_table(Gd, labd)["bridge_score"]
    m = bd.notna() & br["bridge_score"].notna()
    rob.append({"check": f"min_df={md}", "communities": len(set(labd)), "modularity": round(modd, 3),
                "ARI_vs_semantic": round(adjusted_rand_score(labd, SEM), 3),
                "ARI_vs_lexical_nonames": round(adjusted_rand_score(labd, text_labels["lexical_nonames"]), 3),
                "bridge_score_spearman_vs_main": round(spearmanr(bd[m], br.loc[m, "bridge_score"])[0], 3),
                f"top{TOP}_bridge_overlap": round(top_overlap(bd), 2)})
keep = ~df["short_bio"].to_numpy()
rob.append({"check": f"without short bios (n={keep.sum()})",
            "ARI_vs_semantic": round(adjusted_rand_score(labels[MAIN][keep], SEM[keep]), 3),
            "ARI_vs_lexical_nonames": round(adjusted_rand_score(labels[MAIN][keep], text_labels["lexical_nonames"][keep]), 3)})
rob.append({"check": "length-adjusted bridge score",
            "bridge_score_spearman_vs_main": round(spearmanr(br.loc[has, "bridge_score_length_adj"],
                                                            br.loc[has, "bridge_score"])[0], 3),
            f"top{TOP}_bridge_overlap": round(top_overlap(br["bridge_score_length_adj"]), 2)})
rob = pd.DataFrame(rob)
rob.to_csv(out("robustness.csv"), index=False)
print("\nRobustness:\n" + rob.to_string(index=False))


# ----------------------------------------------------------------------------
# 7. Node table
# ----------------------------------------------------------------------------
nodes = df[["wp_id", "name", "hpi_raw", "clean_words", "short_bio"]].copy()
nodes["sem_community"] = SEM
nodes["sem_community_label"] = [text_label_names["semantic"][c] for c in SEM]
nodes["n_entities_used"] = n_ent
for name in graphs:
    p = name.replace("entity_", "ent_")
    nodes[f"{p}_community"] = labels[name]
    if name == MAIN:
        nodes[f"{p}_community_label"] = [profiles[name].loc[c, "label"] for c in labels[name]]
        for col in ["degree", "strength", "betweenness", "participation"]:
            nodes[f"{p}_{col}"] = cent[name][col].to_numpy()
for col in ["cross_share", "participation_groups", "groups_reached", "cross_share_in_semantic_net",
            "extra_cross_share", "expected_cross_share_random", "bridge_score", "bridge_score_length_adj",
            "bridge_rank", "bridge_rank_length_adj"]:
    nodes[col] = br[col].to_numpy()
nodes["neighbour_jaccard_entity_sem"] = np.round(neighbour_jaccard(graphs[MAIN], text_graphs["semantic"]), 3)
pairs = matched_pairs(labels[MAIN], SEM)
nodes["mismatch_entity_sem"] = [(a, b) not in pairs for a, b in zip(labels[MAIN], SEM)]
nodes["mentions_out"] = [DG.out_degree(i) for i in range(n)]
nodes["mentions_in"] = [DG.in_degree(i) for i in range(n)]
nodes.to_csv(out("rq2_nodes.csv"), index=False)
print(f"\nMusicians in non-matching communities (entity vs semantic): "
      f"{nodes['mismatch_entity_sem'].sum()} of {n} ({nodes['mismatch_entity_sem'].mean():.1%})")


# ----------------------------------------------------------------------------
# 8. Figures
# ----------------------------------------------------------------------------
G = graphs[MAIN]
pos = nx.spring_layout(G, weight="weight", seed=1, k=0.25, iterations=200)
label_idx = list(top_idx[:12])
fig, axes = plt.subplots(1, 2, figsize=(18, 8))
for ax, colours, title in [(axes[0], labels[MAIN], f"Entity network, coloured by entity communities "
                                                   f"({len(set(labels[MAIN]))})"),
                           (axes[1], SEM, "Same layout, coloured by RQ1 semantic communities\n"
                                          f"(labelled: top {len(label_idx)} bridges)")]:
    nx.draw_networkx_edges(G, pos, alpha=0.07, width=0.5, ax=ax)
    nx.draw_networkx_nodes(G, pos, node_color=plt.cm.tab20(np.asarray(colours) % 20), node_size=22, ax=ax)
    ax.set_title(title)
    ax.axis("off")
nx.draw_networkx_nodes(G, pos, nodelist=label_idx, node_color=plt.cm.tab20(SEM[label_idx] % 20),
                       node_size=90, edgecolors="black", linewidths=1.2, ax=axes[1])
nx.draw_networkx_labels(G, pos, labels={i: NAMES[i] for i in label_idx}, font_size=7, ax=axes[1])
handles = [plt.Line2D([], [], marker="o", ls="", color=plt.cm.tab20(c % 20), label=SEM_LABEL[c][:35])
           for c in sorted(set(SEM))]
axes[1].legend(handles=handles, fontsize=7, loc="lower left")
plt.tight_layout()
plt.savefig(out("entity_network_bridges.png"), dpi=150)
plt.close()

fig, ax = plt.subplots(figsize=(9, 7))
im = ax.imshow(cont.values, cmap="Blues")
ax.set_xticks(range(cont.shape[1]))
ax.set_yticks(range(cont.shape[0]))
ax.set_xticklabels([SEM_LABEL[c][:24].replace(": ", "\n") for c in cont.columns], fontsize=7)
ax.set_yticklabels([f"E{c}: {profiles[MAIN].loc[c, 'label'][:30]}" for c in cont.index], fontsize=7)
for i in range(cont.shape[0]):
    for j in range(cont.shape[1]):
        ax.text(j, i, cont.values[i, j], ha="center", va="center", fontsize=8,
                color="white" if cont.values[i, j] > cont.values.max() / 2 else "black")
ax.set_xlabel("Semantic community (RQ1)")
ax.set_ylabel("Entity community")
ax.set_title("How entity communities map onto semantic communities")
plt.colorbar(im)
plt.tight_layout()
plt.savefig(out("contingency_entity_vs_semantic.png"), dpi=150)
plt.close()

with open(out("README_outputs.txt"), "w") as f:
    f.write(f"""RQ2 outputs (K={K}, seeds={N_SEEDS}, min_df={args.min_df}, max_df={args.max_df}, types={' '.join(args.types)})

From 4_rq2_extract_entities.py
entity_mentions_raw.csv            raw spaCy mentions (cache)
entities_clean.csv                 musician x entity counts after cleaning
entity_vocabulary.csv              one row per entity (CHECK BY HAND)
entity_cleaning_log.csv            removed mentions and why

From 5_rq2_pipeline.py
network_quality.csv                entity networks (all types + per type) and RQ1 networks
edges_entity_*.csv                 entity network edges (source_wp_id, target_wp_id, similarity)
communities_entity_*.csv           community profiles: top entities, main semantic community, era, country
comparison_summary.csv             entity vs text networks: ARI/NMI vs permutation, edge Jaccard vs chance,
                                   neighbour overlap; RQ1 text-vs-text rows included for reference
contingency_entity_vs_semantic.*   table and heatmap
communities_vs_era_country.csv     NMI of every partition with era and country
rq2_nodes.csv                      one row per musician: entity communities, centralities, bridge measures,
                                   mention in/out degree (share with RQ3)
rq2_top_bridges.csv                top {TOP} bridges + the entities that create their cross-group links
rq2_bridge_explanations.csv        every cross-group link of the top bridges with its shared entities
rq2_hidden_bridges.csv             musicians inside one group by text but spread out by entities
rq2_bridging_entities.csv          entities spread over many semantic communities
bridge_correlates.csv              bridge score vs length, HPI, birth year, number of entities
edges_mentions.csv, mentions_summary.csv   direct mention network (A's biography names musician B)
robustness.csv                     K, min_df, without short bios, length-adjusted bridge score
entity_network_bridges.png         network figure with top bridges labelled

Bridge measures (entity network, groups = RQ1 semantic communities)
cross_share            share of a musician's entity-link weight going to other semantic communities
participation_groups   1 - sum over groups of (weight share)^2 : high = links spread over many groups
bridge_score           mean of percentile ranks of betweenness and participation_groups
cross_share_in_semantic_net / extra_cross_share   same measure in the semantic network / the difference
""")
print(f"\nDone. All outputs are in the folder: {args.outdir}/")