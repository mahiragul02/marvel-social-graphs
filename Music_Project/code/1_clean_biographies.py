"""
Clean Wikipedia biography text for NLP.

Input : top_500_musicians_with_text.csv   (must contain wp_id, name, article_text)
Output: top_500_musicians_clean.csv       (adds 3 columns, see bottom of file)

What it does
1. Splits each article into sections using the "== Heading ==" lines.
2. Removes back-matter sections (References, External links, See also, ...).
   Sub-sections of a removed section are removed too (e.g. "=== Sources ===" under References).
3. Optionally removes list-type sections (Discography, Filmography, Awards, ...).
4. Removes the heading lines themselves and leftover {{ }} template text.
5. Adds: article_text_clean, clean_words, clean_share.
"""

import re
import pandas as pd

INPUT_CSV = "top_500_musicians_with_text.csv"
OUTPUT_CSV = "top_500_musicians_clean.csv"

# Set to False if you want to keep awards / works sections (they may contain
# organisations and titles useful for entity extraction).
DROP_LIST_SECTIONS = True

# Section titles are matched in full (case-insensitive), so a section such as
# "Notes on his style" is NOT removed.
BACKMATTER = {
    "references", "external links", "see also", "further reading", "notes",
    "sources", "bibliography", "footnotes", "citations", "explanatory notes",
    "general references", "cited works", "works cited", "references and notes",
    "notes and references", "external link",
}
LIST_SECTIONS = {
    "discography", "filmography", "videography", "awards", "awards and nominations",
    "awards and honours", "awards and honors", "honours", "honors", "accolades",
    "works", "compositions", "list of compositions", "selected works",
    "selected compositions", "selected discography", "selected recordings",
    "recordings", "albums", "studio albums", "singles", "tours", "concert tours",
    "publications", "writings", "books", "tribute albums", "chart history",
    "live albums", "compilation albums", "video albums", "other albums",
    "notable recordings", "film scores", "musicals", "operas", "symphonies",
    "concertos", "chamber music", "piano works", "songs", "bibliography",
}

HEADING_RE = re.compile(r"^(={2,})\s*(.+?)\s*\1\s*$", re.MULTILINE)


def clean_article(text, drop_list_sections=True):
    """Return the article text without back-matter / list sections and headings."""
    drop_titles = set(BACKMATTER)
    if drop_list_sections:
        drop_titles |= LIST_SECTIONS

    # Everything before the first heading is the lead section (always kept).
    matches = list(HEADING_RE.finditer(text))
    pieces = [text[: matches[0].start()]] if matches else [text]

    skip_level = None  # while not None, we are inside a removed section
    for i, m in enumerate(matches):
        level = len(m.group(1))
        title = m.group(2).strip().lower()
        body = text[m.end(): matches[i + 1].start() if i + 1 < len(matches) else len(text)]

        if skip_level is not None:
            if level > skip_level:      # sub-section of a removed section
                continue
            skip_level = None           # same or higher level heading: stop skipping

        if title in drop_titles:
            skip_level = level
            continue

        pieces.append(body)             # keep body, drop the heading line itself

    out = "\n".join(pieces)
    out = re.sub(r"\{\{.*?\}\}", " ", out, flags=re.DOTALL)  # leftover templates
    out = re.sub(r"[ \t]+", " ", out)
    out = re.sub(r"\n\s*\n+", "\n", out).strip()
    return out


def main():
    df = pd.read_csv(INPUT_CSV)

    df["article_text_clean"] = df["article_text"].apply(
        lambda t: clean_article(t, DROP_LIST_SECTIONS)
    )
    df["clean_words"] = df["article_text_clean"].str.split().str.len()
    df["clean_share"] = (df["clean_words"] / df["words"]).round(4)

    df.to_csv(OUTPUT_CSV, index=False, encoding="utf-8")

    # ---- quick report ----
    print(f"Saved {OUTPUT_CSV}: {df.shape[0]} rows, {df.shape[1]} columns")
    print("\nClean word count:")
    print(df["clean_words"].describe().round(0).to_string())
    print(f"\nBiographies with < 500 clean words : {(df['clean_words'] < 500).sum()}")
    print(f"Biographies with < 1000 clean words: {(df['clean_words'] < 1000).sum()}")
    print("\nShortest 10 after cleaning:")
    print(df.nsmallest(10, "clean_words")[["name", "words", "clean_words"]].to_string(index=False))


if __name__ == "__main__":
    main()
