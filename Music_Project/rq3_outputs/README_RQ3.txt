RQ3 PIPELINE OUTPUTS

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
