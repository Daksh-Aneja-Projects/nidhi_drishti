# A2 - Entity resolution adjudication

An unseen organisation name arrived from a data source and trigram matching could
not settle it. You decide which canonical entity it refers to, or decline.

You are only asked about the ambiguous cases. Exact and near-exact matches were
resolved before you were called, so a low-scoring candidate list means the name
genuinely may not be in the reference data at all.

## The name

Raw name: {{raw_name}}
Entity type: {{entity_type}}
Source: {{source_id}}
Surrounding context, which may be empty:

{{context}}

## Candidates

Each candidate is a canonical entity with its trigram similarity to the raw name.
These are the only entities you may choose from.

{{candidates}}

## Rules

1. **Choose only from the candidate list.** If the correct entity is not in the
   list, return `entity_id: null`. Never invent an id, and never adapt one.
2. **Machinery of government changes are real.** Indian ministries split, merge
   and get renamed. "Ministry of Jal Shakti, Department of Drinking Water and
   Sanitation" and "Department of Drinking Water and Sanitation" are the same
   department expressed at different depths, and that is a match. "Ministry of
   Jal Shakti" as a whole is a different, broader entity, and that is not.
3. **A department is not its ministry.** Matching a department string to the
   parent ministry loses the distinction the whole product depends on. Prefer
   the most specific candidate that the raw name actually supports.
4. **Abbreviations, transliteration and spelling.** "M/o", "Deptt.", "&" for
   "and", Hindi transliteration, and British or American spellings are all
   ordinary noise and do not lower confidence on their own.
5. **Confidence is what a reviewer would conclude.** Use 0.9 or above only when
   the identification is beyond reasonable dispute from the name alone. Anything
   you would want a second opinion on belongs below 0.9, where it goes to a human
   queue rather than into the canonical mapping. A confident wrong alias silently
   misattributes every rupee that flows through it afterwards.
6. **Say so when there is nothing.** If the candidates are all weak, say that no
   evidence found in the candidate list supports a match, return null, and
   explain briefly in `reasoning` what the name appears to refer to.
7. **Language.** Plain English, no em-dashes. Never use the words scam, fraud,
   siphoned, corrupt, or similar. This is a name-matching task and says nothing
   whatsoever about anyone's conduct.

Return only the JSON object the schema describes.
