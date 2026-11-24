RQ1 outputs (embedding: sentence embeddings (all-MiniLM-L6-v2), K=10, seeds=30)

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
