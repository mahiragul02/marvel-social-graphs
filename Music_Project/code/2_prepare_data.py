"""
STEP 2 - Prepare the final shared dataset.

Input : top_500_musicians_clean.csv   (made by 1_clean_biographies.py)
Output: musicians_final_dataset.csv   <- the file every group member uses

Decisions made here (change them if your group decides differently):
  * Remove 3 people the source data flags as "not mainly musicians":
    Naruhito, Baroness Mary Vetsera, Cosima Wagner.   -> 497 musicians
  * Keep Marilyn Manson (band) but mark it (is_true_group = True).
  * Keep very short biographies but mark them (short_bio = True, < 500 clean words),
    so analyses can be repeated without them as a robustness check.
"""

import math
import pandas as pd

df = pd.read_csv("top_500_musicians_clean.csv")

NOT_MUSICIANS = ["Naruhito", "Baroness Mary Vetsera", "Cosima Wagner"]
removed = df[df["name"].isin(NOT_MUSICIANS)]
df = df[~df["name"].isin(NOT_MUSICIANS)].copy()

df["short_bio"] = df["clean_words"] < 500
df["log_clean_words"] = df["clean_words"].apply(math.log10)

keep = [
    # identifiers
    "wp_id", "wd_id", "name", "wiki_url",
    # outcome for RQ3
    "hpi_raw",
    # historical attributes / controls
    "gender", "alive", "birthyear", "deathyear", "bplace_country", "is_true_group",
    # biography length controls
    "words", "clean_words", "log_clean_words", "clean_share", "short_bio",
    # HPI components (use for sensitivity checks only, NOT as controls)
    "non_en_page_views", "log_non_en_views", "l", "l_",
    # provenance / quality
    "revision_id", "last_updated", "backmatter_share", "list_section_share", "data_flag",
    # text for NLP
    "article_text_clean",
]
df = df[keep].reset_index(drop=True)
df.to_csv("musicians_final_dataset.csv", index=False, encoding="utf-8")

print(f"Removed {len(removed)} rows: {removed['name'].tolist()}")
print(f"Saved musicians_final_dataset.csv: {len(df)} musicians, {df.shape[1]} columns")
print(f"Short biographies (< 500 clean words): {int(df['short_bio'].sum())}")
miss = df.drop(columns=["article_text_clean"]).isna().sum()
print("Columns with missing values:\n" + miss[miss > 0].to_string())
