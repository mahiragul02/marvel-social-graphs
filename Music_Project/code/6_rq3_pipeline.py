#!/usr/bin/env python3
"""
RQ3 PIPELINE — Historical popularity and network position

Tests whether HPI is associated with musicians' structural position in:
  1) the RQ1 semantic similarity network
  2) the RQ2 all-entities network

Expected project layout:
  Music_Project/
    code/6_rq3_pipeline.py
    data/musicians_final_dataset.csv
    rq1/rq1_nodes.csv
    rq1/edges_semantic.csv
    rq2/rq2_nodes.csv
    rq2/edges_entity_all.csv

Run from the project root OR from the code folder:
  python code/6_rq3_pipeline.py
  python 6_rq3_pipeline.py

The script recomputes network metrics from the edge lists, merges by wp_id,
and fits OLS models with HC3 heteroskedasticity-robust standard errors.
Centrality measures are tested separately to avoid interpreting unstable
coefficients from highly collinear centrality measures entered together.
"""

import argparse
import os
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
import networkx as nx
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from scipy.stats import spearmanr
from sklearn.preprocessing import StandardScaler
import statsmodels.formula.api as smf

# Resolve defaults relative to Music_Project (parent of this script's code folder),
# rather than relative to whichever directory the terminal happens to use.
PROJECT_DIR = Path(__file__).resolve().parent.parent

parser = argparse.ArgumentParser()
parser.add_argument("--input", default=str(PROJECT_DIR / "data" / "musicians_final_dataset.csv"))
parser.add_argument("--rq1-nodes", default=str(PROJECT_DIR / "rq1" / "rq1_nodes.csv"))
parser.add_argument("--rq2-nodes", default=str(PROJECT_DIR / "rq2" / "rq2_nodes.csv"))
parser.add_argument("--semantic-edges", default=str(PROJECT_DIR / "rq1" / "edges_semantic.csv"))
parser.add_argument("--entity-edges", default=str(PROJECT_DIR / "rq2" / "edges_entity_all.csv"))
parser.add_argument("--outdir", default=str(PROJECT_DIR / "rq3_outputs"))
parser.add_argument("--exclude-short", action="store_true",
                    help="Run the main models after excluding short biographies.")
args = parser.parse_args()

# Relative paths supplied manually are also interpreted from Music_Project.
def project_path(value):
    path = Path(value).expanduser()
    return path if path.is_absolute() else PROJECT_DIR / path

args.input = str(project_path(args.input))
args.rq1_nodes = str(project_path(args.rq1_nodes))
args.rq2_nodes = str(project_path(args.rq2_nodes))
args.semantic_edges = str(project_path(args.semantic_edges))
args.entity_edges = str(project_path(args.entity_edges))
args.outdir = str(project_path(args.outdir))

os.makedirs(args.outdir, exist_ok=True)
OUT = lambda name: os.path.join(args.outdir, name)
warnings.filterwarnings("ignore", category=RuntimeWarning)

for label, filename in [
    ("final dataset", args.input),
    ("RQ1 node table", args.rq1_nodes),
    ("RQ2 node table", args.rq2_nodes),
    ("semantic edge list", args.semantic_edges),
    ("entity edge list", args.entity_edges),
]:
    if not os.path.isfile(filename):
        raise FileNotFoundError(
            f"Could not find {label}: {filename}\\n"
            f"Expected the project folders to be inside: {PROJECT_DIR}"
        )

# ---------------------------------------------------------------------
# 1. Load and validate inputs
# ---------------------------------------------------------------------
df = pd.read_csv(args.input)
rq1 = pd.read_csv(args.rq1_nodes)
rq2 = pd.read_csv(args.rq2_nodes)
sem_edges = pd.read_csv(args.semantic_edges)
ent_edges = pd.read_csv(args.entity_edges)

required = {"wp_id", "name", "hpi_raw", "log_clean_words"}
missing = required - set(df.columns)
if missing:
    raise ValueError(f"Final dataset is missing required columns: {sorted(missing)}")
if df["wp_id"].duplicated().any():
    raise ValueError("Duplicate wp_id values in final dataset.")

base_ids = set(df["wp_id"])
for label, table in [("RQ1 nodes", rq1), ("RQ2 nodes", rq2)]:
    if "wp_id" not in table:
        raise ValueError(f"{label} has no wp_id column.")
    if table["wp_id"].duplicated().any():
        raise ValueError(f"Duplicate wp_id values in {label}.")
    missing_ids = base_ids - set(table["wp_id"])
    if missing_ids:
        raise ValueError(f"{label} is missing {len(missing_ids)} musicians.")

print(f"Loaded final dataset: {len(df)} musicians")
print(f"Semantic edges: {len(sem_edges)} | Entity edges: {len(ent_edges)}")

# ---------------------------------------------------------------------
# 2. Rebuild graphs and calculate comparable network measures
# ---------------------------------------------------------------------
def build_graph(edge_df, label):
    needed = {"source_wp_id", "target_wp_id", "similarity"}
    if not needed.issubset(edge_df.columns):
        raise ValueError(f"{label} edge file must contain {sorted(needed)}")
    G = nx.Graph()
    G.add_nodes_from(df["wp_id"].tolist())
    for s, t, w in edge_df[list(["source_wp_id", "target_wp_id", "similarity"])].itertuples(index=False, name=None):
        if s not in base_ids or t not in base_ids:
            continue
        w = float(w)
        if not np.isfinite(w) or w <= 0 or s == t:
            continue
        # Preserve the strongest edge if duplicate undirected rows exist.
        if G.has_edge(s, t):
            G[s][t]["weight"] = max(G[s][t]["weight"], w)
        else:
            G.add_edge(s, t, weight=w)
    # Similarity is strength; inverse similarity is shortest-path distance.
    for u, v, d in G.edges(data=True):
        d["distance"] = 1.0 / max(d["weight"], 1e-12)
    print(f"{label}: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges, "
          f"density={nx.density(G):.4f}, components={nx.number_connected_components(G)}")
    return G

G_sem = build_graph(sem_edges, "Semantic")
G_ent = build_graph(ent_edges, "All-entities")

def calculate_metrics(G, prefix, community_series):
    degree = dict(G.degree())
    strength = dict(G.degree(weight="weight"))
    betweenness = nx.betweenness_centrality(G, weight="distance", normalized=True)
    # Harmonic centrality is defined for disconnected graphs.
    harmonic = nx.harmonic_centrality(G, distance="distance")
    try:
        eigen = nx.eigenvector_centrality(G, max_iter=2000, weight="weight")
    except (nx.PowerIterationFailedConvergence, nx.NetworkXException):
        eigen = {n: np.nan for n in G.nodes()}

    communities = community_series.to_dict()
    participation = {}
    cross_share = {}
    for node in G.nodes():
        nbrs = list(G.neighbors(node))
        if not nbrs:
            participation[node] = 0.0
            cross_share[node] = 0.0
            continue
        by_group = {}
        total = 0.0
        cross = 0.0
        for nbr in nbrs:
            w = G[node][nbr]["weight"]
            total += w
            group = communities.get(nbr, "Unknown")
            by_group[group] = by_group.get(group, 0.0) + w
            if communities.get(node, "Unknown") != group:
                cross += w
        participation[node] = 1 - sum((v / total) ** 2 for v in by_group.values())
        cross_share[node] = cross / total if total else 0.0

    result = pd.DataFrame({
        "wp_id": list(G.nodes()),
        f"{prefix}_degree": [degree[n] for n in G.nodes()],
        f"{prefix}_strength": [strength[n] for n in G.nodes()],
        f"{prefix}_betweenness": [betweenness[n] for n in G.nodes()],
        f"{prefix}_harmonic": [harmonic[n] for n in G.nodes()],
        f"{prefix}_eigenvector": [eigen[n] for n in G.nodes()],
        f"{prefix}_participation": [participation[n] for n in G.nodes()],
        f"{prefix}_cross_share": [cross_share[n] for n in G.nodes()],
    })
    return result

sem_communities = rq1.set_index("wp_id")["sem_community"]
ent_communities = rq2.set_index("wp_id")["ent_all_community"]

sem_metrics = calculate_metrics(G_sem, "sem", sem_communities)
ent_metrics = calculate_metrics(G_ent, "ent", ent_communities)

# ---------------------------------------------------------------------
# 3. Merge and validate analysis dataset
# ---------------------------------------------------------------------
analysis = df.copy()
analysis = analysis.merge(sem_metrics, on="wp_id", how="left", validate="one_to_one")
analysis = analysis.merge(ent_metrics, on="wp_id", how="left", validate="one_to_one")

# Retain existing RQ1/RQ2 bridge measures as supplementary variables.
keep_rq1 = ["wp_id", "sem_community", "sem_strength", "sem_betweenness",
            "sem_participation"]
# Avoid duplicate columns: the recomputed metrics are authoritative.
for c in ["sem_community"]:
    if c in rq1.columns:
        analysis = analysis.merge(rq1[["wp_id", c]], on="wp_id", how="left",
                                  validate="one_to_one", suffixes=("", "_rq1"))
for c in ["bridge_score", "bridge_score_length_adj", "cross_share",
          "participation_groups", "groups_reached", "mentions_in", "mentions_out"]:
    if c in rq2.columns:
        analysis = analysis.merge(rq2[["wp_id", c]], on="wp_id", how="left",
                                  validate="one_to_one")

analysis.to_csv(OUT("rq3_analysis_dataset.csv"), index=False)
analysis.to_csv(OUT("rq3_node_metrics.csv"), index=False)

# Network summary
summary = []
for name, G in [("semantic", G_sem), ("entity_all", G_ent)]:
    summary.append({
        "network": name, "nodes": G.number_of_nodes(), "edges": G.number_of_edges(),
        "density": nx.density(G), "components": nx.number_connected_components(G),
        "isolates": nx.number_of_isolates(G),
        "mean_degree": np.mean([d for _, d in G.degree()]),
        "mean_strength": np.mean([s for _, s in G.degree(weight="weight")]),
    })
pd.DataFrame(summary).to_csv(OUT("network_summary_rq3.csv"), index=False)

# ---------------------------------------------------------------------
# 4. Prepare predictors and descriptive associations
# ---------------------------------------------------------------------
# Transform right-skewed centralities before standardising. Betweenness can
# contain many zeros; log1p preserves zeros and reduces extreme leverage.
metric_names = [
    "sem_degree", "sem_strength", "sem_betweenness", "sem_harmonic",
    "sem_eigenvector", "sem_participation", "sem_cross_share",
    "ent_degree", "ent_strength", "ent_betweenness", "ent_harmonic",
    "ent_eigenvector", "ent_participation", "ent_cross_share",
]
for col in metric_names:
    vals = pd.to_numeric(analysis[col], errors="coerce")
    if col.endswith(("degree", "strength", "betweenness", "harmonic")):
        vals = np.log1p(vals.clip(lower=0))
    analysis[col + "_z"] = (vals - vals.mean()) / vals.std(ddof=0)

analysis["birthyear"] = pd.to_numeric(analysis["birthyear"], errors="coerce")
analysis["birthyear_z"] = (
    (analysis["birthyear"] - analysis["birthyear"].mean()) /
    analysis["birthyear"].std(ddof=0)
)
analysis["hpi_raw"] = pd.to_numeric(analysis["hpi_raw"], errors="coerce")
analysis["log_clean_words"] = pd.to_numeric(analysis["log_clean_words"], errors="coerce")

# Use categorical controls where available. Country is deliberately not added
# as hundreds of fixed effects; it can be considered in a later sensitivity run.
for c in ["gender", "alive", "is_true_group"]:
    if c in analysis.columns:
        analysis[c] = analysis[c].astype("string").fillna("Unknown").astype(str)

# Spearman correlations (descriptive, not causal).
corr_rows = []
for col in metric_names + ["log_clean_words", "birthyear"]:
    x = analysis[col] if col in analysis else analysis[col + "_z"]
    valid = analysis["hpi_raw"].notna() & x.notna()
    if valid.sum() > 2:
        rho, p = spearmanr(x[valid], analysis.loc[valid, "hpi_raw"])
        corr_rows.append({"variable": col, "n": int(valid.sum()),
                          "spearman_rho_with_hpi": rho, "p_value": p})
pd.DataFrame(corr_rows).to_csv(OUT("spearman_correlations.csv"), index=False)

# ---------------------------------------------------------------------
# 5. Regression models
# ---------------------------------------------------------------------
# Baseline controls: biography length, birth cohort, gender, alive status,
# and individual/group status where these fields exist.
control_terms = ["log_clean_words", "birthyear_z"]
for c in ["gender", "alive", "is_true_group"]:
    if c in analysis.columns and analysis[c].nunique(dropna=False) > 1:
        counts = analysis[c].value_counts(dropna=False)
        # Avoid unstable dummy coefficients for categories represented by only
        # a handful of cases (e.g. a single musical group in this sample).
        if counts.min() >= 10:
            control_terms.append(f"C({c})")
base_rhs = " + ".join(control_terms)

# Centralities are tested one at a time. Strength is the primary connectivity
# measure; betweenness and participation capture brokerage; harmonic/eigenvector
# provide alternative notions of reach and influence.
network_predictors = [
    ("sem_strength_z", "Semantic", "Weighted degree / strength"),
    ("sem_betweenness_z", "Semantic", "Betweenness"),
    ("sem_participation_z", "Semantic", "Participation coefficient"),
    ("sem_harmonic_z", "Semantic", "Harmonic centrality"),
    ("sem_eigenvector_z", "Semantic", "Eigenvector centrality"),
    ("ent_strength_z", "Entity", "Weighted degree / strength"),
    ("ent_betweenness_z", "Entity", "Betweenness"),
    ("ent_participation_z", "Entity", "Participation coefficient"),
    ("ent_harmonic_z", "Entity", "Harmonic centrality"),
    ("ent_eigenvector_z", "Entity", "Eigenvector centrality"),
]

def fit_model(data, model_name, rhs):
    formula = "hpi_raw ~ " + rhs
    model = smf.ols(formula, data=data).fit(cov_type="HC3")
    fit = {
        "model": model_name, "n": int(model.nobs), "r_squared": model.rsquared,
        "adjusted_r_squared": model.rsquared_adj, "aic": model.aic,
        "bic": model.bic, "f_pvalue": model.f_pvalue,
    }
    return model, fit

model_rows, fit_rows = [], []
models = {}
model_specs = [("M0_length_only", "log_clean_words")]
model_specs.append(("M1_historical_controls", base_rhs))
for col, network, label in network_predictors:
    model_specs.append((f"{network}_{label}".replace(" ", "_"),
                        base_rhs + " + " + col))

# Main comparative models: same primary strength metric in each network.
model_specs.extend([
    ("M_semantic_strength", base_rhs + " + sem_strength_z"),
    ("M_entity_strength", base_rhs + " + ent_strength_z"),
    ("M_both_strength", base_rhs + " + sem_strength_z + ent_strength_z"),
    ("M_both_betweenness", base_rhs + " + sem_betweenness_z + ent_betweenness_z"),
    ("M_both_participation", base_rhs + " + sem_participation_z + ent_participation_z"),
])

data_main = analysis.copy()
if args.exclude_short and "short_bio" in data_main.columns:
    data_main = data_main[~data_main["short_bio"].astype(bool)].copy()

for name, rhs in model_specs:
    try:
        model, fit = fit_model(data_main, name, rhs)
        models[name] = model
        fit_rows.append(fit)
        for term in model.params.index:
            model_rows.append({
                "model": name, "term": term, "coefficient": model.params[term],
                "robust_se_HC3": model.bse[term], "p_value": model.pvalues[term],
                "ci_lower": model.conf_int().loc[term, 0],
                "ci_upper": model.conf_int().loc[term, 1],
            })
    except Exception as e:
        print(f"[WARNING] Could not fit {name}: {e}")

pd.DataFrame(fit_rows).to_csv(OUT("model_fit_comparison.csv"), index=False)
pd.DataFrame(model_rows).to_csv(OUT("regression_coefficients_HC3.csv"), index=False)

# Compact main model table for quick reporting.
main_names = ["M0_length_only", "M1_historical_controls",
              "M_semantic_strength", "M_entity_strength", "M_both_strength",
              "M_both_betweenness", "M_both_participation"]
main_fit = pd.DataFrame(fit_rows)
main_fit[main_fit["model"].isin(main_names)].to_csv(
    OUT("main_model_comparison.csv"), index=False)

# ---------------------------------------------------------------------
# 6. Robustness: exclude short biographies
# ---------------------------------------------------------------------
if not args.exclude_short and "short_bio" in analysis.columns:
    keep = ~analysis["short_bio"].astype(bool)
    rob_data = analysis.loc[keep].copy()
    rob_rows = []
    for name, rhs in [
        ("controls", base_rhs),
        ("controls_semantic_strength", base_rhs + " + sem_strength_z"),
        ("controls_entity_strength", base_rhs + " + ent_strength_z"),
        ("controls_both_strength", base_rhs + " + sem_strength_z + ent_strength_z"),
    ]:
        try:
            m, f = fit_model(rob_data, name, rhs)
            rob_rows.append(f)
        except Exception as e:
            print(f"[WARNING] Short-bio robustness {name}: {e}")
    pd.DataFrame(rob_rows).to_csv(OUT("robustness_without_short_bios.csv"), index=False)

# ---------------------------------------------------------------------
# 7. Figures
# ---------------------------------------------------------------------
def scatter_plot(xcol, title, filename, xlabel):
    x = analysis[xcol]
    y = analysis["hpi_raw"]
    ok = x.notna() & y.notna()
    fig, ax = plt.subplots(figsize=(7, 5))
    ax.scatter(x[ok], y[ok], alpha=0.55, s=22)
    if ok.sum() > 2:
        z = np.polyfit(x[ok], y[ok], 1)
        xx = np.linspace(x[ok].min(), x[ok].max(), 100)
        ax.plot(xx, np.polyval(z, xx), linewidth=2)
    ax.set_title(title)
    ax.set_xlabel(xlabel)
    ax.set_ylabel("Historical Popularity Index (HPI)")
    ax.grid(alpha=0.2)
    fig.tight_layout()
    fig.savefig(OUT(filename), dpi=180)
    plt.close(fig)

scatter_plot("sem_strength", "HPI and semantic network strength",
             "hpi_semantic_strength.png", "Semantic weighted degree")
scatter_plot("ent_strength", "HPI and entity network strength",
             "hpi_entity_strength.png", "Entity weighted degree")
scatter_plot("sem_betweenness", "HPI and semantic betweenness",
             "hpi_semantic_betweenness.png", "Semantic betweenness")
scatter_plot("ent_betweenness", "HPI and entity betweenness",
             "hpi_entity_betweenness.png", "Entity betweenness")

# Correlation heatmap for key variables.
heat_cols = ["hpi_raw", "log_clean_words", "sem_strength", "sem_betweenness",
             "sem_participation", "ent_strength", "ent_betweenness",
             "ent_participation"]
corr = analysis[heat_cols].corr(method="spearman")
fig, ax = plt.subplots(figsize=(9, 7))
im = ax.imshow(corr.values, vmin=-1, vmax=1, aspect="auto")
ax.set_xticks(range(len(heat_cols)))
ax.set_yticks(range(len(heat_cols)))
ax.set_xticklabels(heat_cols, rotation=45, ha="right", fontsize=8)
ax.set_yticklabels(heat_cols, fontsize=8)
for i in range(len(heat_cols)):
    for j in range(len(heat_cols)):
        ax.text(j, i, f"{corr.iloc[i, j]:.2f}", ha="center", va="center", fontsize=7)
ax.set_title("Spearman correlation: HPI, controls and network measures")
fig.colorbar(im, ax=ax, shrink=0.8)
fig.tight_layout()
fig.savefig(OUT("correlation_heatmap.png"), dpi=180)
plt.close(fig)

# ---------------------------------------------------------------------
# 8. Diagnostics and README
# ---------------------------------------------------------------------
if "M_both_strength" in models:
    m = models["M_both_strength"]
    fig, axes = plt.subplots(1, 2, figsize=(11, 4))
    axes[0].scatter(m.fittedvalues, m.resid, alpha=0.55, s=20)
    axes[0].axhline(0, linewidth=1)
    axes[0].set_xlabel("Fitted HPI")
    axes[0].set_ylabel("Residual")
    axes[0].set_title("Residuals vs fitted")
    smf  # keeps statsmodels formula interface explicit in this script
    from scipy.stats import probplot
    probplot(m.resid, dist="norm", plot=axes[1])
    axes[1].set_title("Residual Q-Q plot")
    fig.tight_layout()
    fig.savefig(OUT("diagnostics_M_both_strength.png"), dpi=180)
    plt.close(fig)

with open(OUT("README_RQ3.txt"), "w", encoding="utf-8") as f:
    f.write("""RQ3 PIPELINE OUTPUTS

rq3_analysis_dataset.csv / rq3_node_metrics.csv
    Final dataset merged with recomputed semantic and entity network metrics.

network_summary_rq3.csv
    Nodes, edges, density, components, isolates, mean degree and strength.

spearman_correlations.csv
    Descriptive Spearman associations with HPI.

model_fit_comparison.csv
    R-squared, adjusted R-squared, AIC, BIC and model sample sizes.

main_model_comparison.csv
    Compact comparison of baseline, controls, semantic, entity and combined models.

regression_coefficients_HC3.csv
    OLS coefficients, HC3 robust standard errors, p-values and confidence intervals.

robustness_without_short_bios.csv
    Re-estimates key models after excluding short biographies.

Figures
    HPI-centrality scatterplots, correlation heatmap and regression diagnostics.

INTERPRETATION NOTES
1. The analysis is observational and cross-sectional; associations are not causal.
2. The sample contains the selected 497 musicians, not all musicians. Results
   should be generalised only to this sample/population with caution.
3. Centrality measures are correlated. The pipeline therefore tests them one
   at a time and uses selected paired models rather than one large model.
4. OLS uses HC3 heteroskedasticity-robust standard errors. Inspect diagnostics.
5. Biography length and historical controls are included to reduce confounding,
   but they do not eliminate all possible confounding.
6. The entity and semantic networks use different edge-generation processes.
   Compare effect sizes and model fit cautiously.
7. The network measures are recalculated from the supplied edge lists.
""")

print("\nRQ3 pipeline complete.")
print(f"Outputs saved to: {args.outdir}/")
print("Start with main_model_comparison.csv and regression_coefficients_HC3.csv.")
