"""
RQ2 STEP 1 - Named-entity extraction from the musicians' biographies

RQ2: How do networks based on shared named entities in musicians' biographies
     differ from networks based on textual similarity, and which musicians
     bridge otherwise distinct groups?

This script only produces the entity table. The networks are built by
5_rq2_pipeline.py.

Input : data/musicians_final_dataset.csv   (article_text_clean has no hyperlinks,
                                            so entities come from NER, not links)
Run   : python 4_rq2_extract_entities.py                          (en_core_web_lg, a few minutes)
        python 4_rq2_extract_entities.py --model en_core_web_trf  (more accurate, slow without a GPU)
        python 4_rq2_extract_entities.py --from-mentions          (skip NER, only redo the cleaning
                                                                   from the cached raw mentions)
Setup : pip install spacy
        python -m spacy download en_core_web_lg      (or en_core_web_trf)

Steps
  1. spaCy NER on every biography -> raw mentions (cached, the slow part)
  2. keep PERSON, ORG, places (GPE/LOC/FAC), WORK_OF_ART, EVENT
  3. normalise text ("The Beatles" / "Beatles" / "Beatles'" -> "beatles",
     accents removed, "R.E.M." -> "rem")
  4. surname resolution inside each biography ("Lennon" -> "john lennon" when
     the same biography mentions exactly one "... Lennon"), then across the
     corpus when one full name clearly dominates
  5. remove self-mentions: the musician's own name and its parts, the birth
     name given in the first sentence, and people with the same surname
     (the musician or family members)
  6. one type per entity (majority vote over the corpus)

Outputs (folder --outdir, default rq2/)
  entity_mentions_raw.csv   one row per mention found by spaCy (cache)
  entities_clean.csv        one row per musician x entity: wp_id, name, entity_key, entity, type, count
  entity_vocabulary.csv     one row per entity: key, display name, type, n_musicians, n_mentions, variants
  entity_cleaning_log.csv   every removed mention and the reason
"""

import argparse
import os
import re
import unicodedata
from collections import Counter, defaultdict

import pandas as pd

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

parser = argparse.ArgumentParser()
parser.add_argument("--input", default=os.path.join(BASE, "data", "musicians_final_dataset.csv"))
parser.add_argument("--outdir", default=os.path.join(BASE, "rq2"))
parser.add_argument("--model", default="en_core_web_lg",
                    help="spaCy model name (en_core_web_lg default; en_core_web_trf is more accurate but slow)")
parser.add_argument("--batch-size", type=int, default=8)
parser.add_argument("--n-process", type=int, default=1, help=">1 only helps for non-transformer models")
parser.add_argument("--from-mentions", action="store_true",
                    help="reuse entity_mentions_raw.csv instead of running NER again")
parser.add_argument("--surname-share", type=float, default=0.8,
                    help="corpus-level: map 'Lennon' to 'John Lennon' only if that full name has "
                         "at least this share of all full names ending in 'Lennon'")
args = parser.parse_args()

os.makedirs(args.outdir, exist_ok=True)
out = lambda name: os.path.join(args.outdir, name)
RAW_FILE = out("entity_mentions_raw.csv")

LABEL_MAP = {"PERSON": "PERSON", "ORG": "ORG",
             "GPE": "PLACE", "LOC": "PLACE", "FAC": "PLACE",
             "WORK_OF_ART": "WORK", "EVENT": "EVENT"}
# dropped on purpose: NORP (nationalities, "American"), DATE, CARDINAL, MONEY, LANGUAGE ...

df = pd.read_csv(args.input)
print(f"Loaded {len(df)} musicians from {args.input}")


# ----------------------------------------------------------------------------
# 1. NER
# ----------------------------------------------------------------------------
def run_ner(df):
    import spacy
    tried = [args.model] + [m for m in ("en_core_web_lg", "en_core_web_trf", "en_core_web_md", "en_core_web_sm")
                            if m != args.model]
    nlp = None
    for m in tried:
        try:
            nlp = spacy.load(m)
            if m != args.model:
                print(f"NOTE: '{args.model}' is not installed, using '{m}' instead")
            args.model = m
            break
        except OSError:
            continue
    if nlp is None:
        import sys
        raise SystemExit("No English spaCy model is installed for THIS Python:\n  " + sys.executable +
                         "\nInstall one with exactly this Python:\n  \"" + sys.executable +
                         "\" -m spacy download en_core_web_lg")
    keep = [p for p in nlp.pipe_names if p in ("transformer", "tok2vec", "ner")]
    nlp.select_pipes(enable=keep)                       # tagger/parser are not needed: faster
    nlp.max_length = max(nlp.max_length, int(df["article_text_clean"].str.len().max()) + 1000)
    print(f"Running {args.model} (components: {keep}) on {len(df)} biographies ...")
    rows = []
    docs = nlp.pipe(df["article_text_clean"].tolist(), batch_size=args.batch_size,
                    n_process=args.n_process)
    for i, doc in enumerate(docs):
        wp = int(df["wp_id"].iloc[i])
        for e in doc.ents:
            rows.append((wp, e.text, e.label_, e.start_char, e.end_char))
        if (i + 1) % 25 == 0 or i + 1 == len(df):
            print(f"  {i + 1}/{len(df)} biographies, {len(rows)} mentions so far")
    raw = pd.DataFrame(rows, columns=["wp_id", "entity_text", "label", "start_char", "end_char"])
    raw.to_csv(RAW_FILE, index=False)
    return raw


if args.from_mentions:
    raw = pd.read_csv(RAW_FILE, keep_default_na=False)
    print(f"Loaded {len(raw)} cached mentions from {RAW_FILE}")
else:
    raw = run_ner(df)


# ----------------------------------------------------------------------------
# 2. Normalisation
# ----------------------------------------------------------------------------
def strip_accents(s):
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def norm_key(text):
    """Matching key: 'The Beatles' -> 'beatles', 'Beyoncé's' -> 'beyonce', 'R.E.M.' -> 'rem'."""
    s = strip_accents(str(text)).replace("’", "'").replace("‘", "'")
    s = s.replace("“", '"').replace("”", '"').replace("\n", " ").strip().strip("\"'")
    s = re.sub(r"'s?$", "", s)                       # possessive
    s = re.sub(r"^the\s+", "", s, flags=re.I)        # leading article
    s = s.lower()
    s = re.sub(r"\.(?=\w)", "", s)                   # R.E.M. -> REM. ; Dr. Dre keeps the space
    s = re.sub(r"[^\w\s&'-]", " ", s)
    s = re.sub(r"\s+", " ", s).strip(" -'")
    return s


def name_key(name):
    """Musician name -> key. 'Marilyn Manson (band)' -> 'marilyn manson'."""
    return norm_key(re.sub(r"\s*\(.*?\)\s*", " ", str(name)))


def junk_reason(key):
    if len(key) < 2 or not re.search(r"[a-z]", key):
        return "junk: too short / no letters"
    if len(key.split()) > 7:
        return "junk: too long"
    return None


raw = raw[raw["label"].isin(LABEL_MAP)].copy()
raw["type"] = raw["label"].map(LABEL_MAP)
raw["entity_key"] = raw["entity_text"].map(norm_key)
raw["reason"] = raw["entity_key"].map(junk_reason)
print(f"Mentions with a kept label: {len(raw)}")

names = dict(zip(df["wp_id"], df["name"]))
texts = dict(zip(df["wp_id"], df["article_text_clean"]))
musician_keys = {name_key(n) for n in df["name"]}


# ----------------------------------------------------------------------------
# 3. Surname resolution inside each biography
# ----------------------------------------------------------------------------
new_keys = raw["entity_key"].copy()
for wp, g in raw[raw["reason"].isna()].groupby("wp_id", sort=False):
    person = g[g["type"] == "PERSON"]["entity_key"]
    full = defaultdict(set)
    for k in person:
        t = k.split()
        if len(t) >= 2:
            full[t[-1]].add(k)
    mapping = {last: next(iter(ks)) for last, ks in full.items() if len(ks) == 1}
    is_single_person = (g["type"] == "PERSON") & (g["entity_key"].str.count(" ") == 0)
    idx = g.index[is_single_person]
    new_keys.loc[idx] = [mapping.get(k, k) for k in g.loc[idx, "entity_key"]]
n_resolved_doc = int((new_keys != raw["entity_key"]).sum())
raw["entity_key"] = new_keys
print(f"Surnames resolved within a biography: {n_resolved_doc}")


# ----------------------------------------------------------------------------
# 4. Self-mentions
# ----------------------------------------------------------------------------
def lead_end(text):
    """End of the 'subject' part of the first sentence: 'Robert Nesta Marley (...) was ...'."""
    m = re.search(r"\s(is|was|are|were)\s", text[:400])
    return m.start() if m else 150


def self_reason(key, typ, me_key, me_tokens, aliases):
    t = key.split()
    ts = set(t)
    if key == me_key or key in aliases:
        return "self: own name / birth name"
    if typ in ("PERSON", "ORG") and ts <= me_tokens:
        return "self: part of own name"
    if typ in ("PERSON", "ORG") and me_tokens <= ts:
        return "self: own name inside a longer name"
    if typ == "PERSON" and len(me_tokens) >= 2 and t[-1] == me_key.split()[-1]:
        return "self/family: same surname"
    for a in aliases:
        at = a.split()
        if typ == "PERSON" and (ts <= set(at) or (len(at) >= 2 and t[-1] == at[-1])):
            return "self/family: matches birth name"
    return None


reasons = raw["reason"].copy()
for wp, g in raw.groupby("wp_id", sort=False):
    me_key = name_key(names.get(wp, ""))
    me_tokens = set(me_key.split())
    end = lead_end(texts.get(wp, ""))
    aliases = {k for k in g[(g["type"] == "PERSON") & (g["end_char"].astype(int) <= end)]["entity_key"]
               if len(k.split()) >= 2}                      # full birth / stage names only
    todo = g.index[reasons.loc[g.index].isna()]
    reasons.loc[todo] = [self_reason(k, ty, me_key, me_tokens, aliases)
                         for k, ty in zip(g.loc[todo, "entity_key"], g.loc[todo, "type"])]
raw["reason"] = reasons

log = raw[raw["reason"].notna()].copy()
log["name"] = log["wp_id"].map(names)
log[["wp_id", "name", "entity_text", "entity_key", "type", "reason"]].to_csv(
    out("entity_cleaning_log.csv"), index=False)
kept = raw[raw["reason"].isna()].copy()
print("Removed mentions:\n" + log["reason"].value_counts().to_string())


# ----------------------------------------------------------------------------
# 5. Surname resolution across the corpus ("Lennon" -> "john lennon")
# ----------------------------------------------------------------------------
person_df = kept[kept["type"] == "PERSON"].groupby("entity_key")["wp_id"].nunique()
full_by_last = defaultdict(Counter)
for k, nm in person_df.items():
    t = k.split()
    if len(t) >= 2:
        full_by_last[t[-1]][k] += nm
corpus_map = {}
for last, cands in full_by_last.items():
    top, c = cands.most_common(1)[0]
    if c >= 2 and c / sum(cands.values()) >= args.surname_share and last not in musician_keys:
        corpus_map[last] = top
single = (kept["type"] == "PERSON") & kept["entity_key"].isin(corpus_map.keys())
kept.loc[single, "entity_key"] = kept.loc[single, "entity_key"].map(corpus_map)
print(f"Single surnames mapped to a full name across the corpus: {int(single.sum())} mentions")

# the corpus mapping can turn a surname into the musician's own full name -> drop those too
own = kept["entity_key"] == kept["wp_id"].map(lambda w: name_key(names[w]))
kept = kept[~own]


# ----------------------------------------------------------------------------
# 6. One type and one display name per entity, aggregate
# ----------------------------------------------------------------------------
type_votes = kept.groupby("entity_key")["type"].agg(lambda s: Counter(s))
major_type = type_votes.map(lambda c: c.most_common(1)[0][0])
kept["type"] = kept["entity_key"].map(major_type)


def display_name(g):
    surf = g["entity_text"].str.replace(r"[’']s$", "", regex=True).str.strip()
    exact = surf[surf.map(norm_key) == g.name]
    return (exact if len(exact) else surf).value_counts().index[0]


disp = kept.groupby("entity_key").apply(display_name, include_groups=False)

clean = (kept.groupby(["wp_id", "entity_key"]).size().rename("count").reset_index())
clean["entity"] = clean["entity_key"].map(disp)
clean["type"] = clean["entity_key"].map(major_type)
clean["name"] = clean["wp_id"].map(names)
clean = clean[["wp_id", "name", "entity_key", "entity", "type", "count"]]
clean.to_csv(out("entities_clean.csv"), index=False)

voc = kept.groupby("entity_key").agg(n_musicians=("wp_id", "nunique"), n_mentions=("wp_id", "size"))
voc["entity"] = disp
voc["type"] = major_type
voc["type_votes"] = type_votes.map(lambda c: "; ".join(f"{k}:{v}" for k, v in c.most_common()))
voc["variants"] = kept.groupby("entity_key")["entity_text"].agg(
    lambda s: " | ".join(s.value_counts().head(5).index))
voc["is_top500_musician"] = voc.index.isin(musician_keys)
voc = voc.reset_index().sort_values(["n_musicians", "n_mentions"], ascending=False)
voc[["entity_key", "entity", "type", "n_musicians", "n_mentions", "is_top500_musician",
     "type_votes", "variants"]].to_csv(out("entity_vocabulary.csv"), index=False)


# ----------------------------------------------------------------------------
# Summary
# ----------------------------------------------------------------------------
per_mus = clean.groupby("wp_id")["entity_key"].nunique().reindex(df["wp_id"], fill_value=0)
print(f"\nKept mentions: {len(kept)} | distinct entities: {len(voc)} | "
      f"entities in >= 2 biographies: {(voc['n_musicians'] >= 2).sum()}")
print(f"Distinct entities per musician: median {per_mus.median():.0f}, "
      f"min {per_mus.min()}, max {per_mus.max()}; musicians with none: {(per_mus == 0).sum()}")
print("\nEntities by type (distinct):\n" + voc["type"].value_counts().to_string())
print("\nMost widely shared entities:\n" +
      voc.head(25)[["entity", "type", "n_musicians"]].to_string(index=False))
print(f"\nDone. Check entity_vocabulary.csv and entity_cleaning_log.csv by hand before running "
      f"5_rq2_pipeline.py. Outputs are in: {args.outdir}/")