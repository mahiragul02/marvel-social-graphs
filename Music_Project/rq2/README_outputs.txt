RQ2 outputs (K=10, seeds=30, min_df=2, max_df=0.5, types=PERSON ORG PLACE WORK EVENT)

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
rq2_top_bridges.csv                top 25 bridges + the entities that create their cross-group links
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
