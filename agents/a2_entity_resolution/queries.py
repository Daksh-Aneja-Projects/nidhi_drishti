"""Candidate generation SQL for A2.

Trigram similarity in the database, not in Python. ``entity_alias`` and the
reference tables carry GIN trigram indexes (db/migrations/0002), so the shortlist
is produced by an index scan rather than by pulling a hundred ministry names into
the process and scoring them one at a time.

The model never sees this query. It sees the shortlist, and it may only choose
from the shortlist.
"""

from __future__ import annotations

#: pg_trgm's default threshold is 0.3 and matches far too much on names that
#: share the word "ministry". 0.35 with an explicit ORDER BY similarity is the
#: shortlist we actually want to adjudicate.
CANDIDATE_SIMILARITY_FLOOR = 0.35

#: Existing aliases first: a name a human already mapped is a stronger signal
#: than a fresh string comparison against a reference table.
MINISTRY_CANDIDATES_SQL = """
WITH alias_hits AS (
  SELECT a.entity_id,
         m.name,
         similarity(a.alias, %(raw_name)s) AS similarity,
         'alias'::text AS via
    FROM entity_alias a
    JOIN ministry m ON m.ministry_id = a.entity_id
   WHERE a.entity_type = 'ministry'
     AND similarity(a.alias, %(raw_name)s) >= %(floor)s
),
reference_hits AS (
  SELECT m.ministry_id AS entity_id,
         m.name,
         similarity(m.name, %(raw_name)s) AS similarity,
         'reference'::text AS via
    FROM ministry m
   WHERE m.active
     AND similarity(m.name, %(raw_name)s) >= %(floor)s
)
SELECT DISTINCT ON (entity_id) entity_id, name, similarity, via
  FROM (SELECT * FROM alias_hits UNION ALL SELECT * FROM reference_hits) hits
 ORDER BY entity_id, similarity DESC
"""

SCHEME_CANDIDATES_SQL = """
WITH alias_hits AS (
  SELECT a.entity_id,
         s.name,
         similarity(a.alias, %(raw_name)s) AS similarity,
         'alias'::text AS via
    FROM entity_alias a
    JOIN scheme s ON s.scheme_id = a.entity_id
   WHERE a.entity_type = 'scheme'
     AND similarity(a.alias, %(raw_name)s) >= %(floor)s
),
reference_hits AS (
  SELECT s.scheme_id AS entity_id,
         s.name,
         similarity(s.name, %(raw_name)s) AS similarity,
         'reference'::text AS via
    FROM scheme s
   WHERE s.active
     AND similarity(s.name, %(raw_name)s) >= %(floor)s
)
SELECT DISTINCT ON (entity_id) entity_id, name, similarity, via
  FROM (SELECT * FROM alias_hits UNION ALL SELECT * FROM reference_hits) hits
 ORDER BY entity_id, similarity DESC
"""

#: A demand number has no reference table of its own, so only prior aliases can
#: suggest one.
DEMAND_CANDIDATES_SQL = """
SELECT a.entity_id,
       a.entity_id AS name,
       similarity(a.alias, %(raw_name)s) AS similarity,
       'alias'::text AS via
  FROM entity_alias a
 WHERE a.entity_type = 'demand'
   AND similarity(a.alias, %(raw_name)s) >= %(floor)s
 ORDER BY similarity DESC
"""

CANDIDATE_SQL_BY_TYPE = {
    "ministry": MINISTRY_CANDIDATES_SQL,
    "scheme": SCHEME_CANDIDATES_SQL,
    "demand": DEMAND_CANDIDATES_SQL,
}

#: An alias row that already exists is not a resolution problem at all.
EXISTING_ALIAS_SQL = """
SELECT entity_id, confidence, resolved_by
  FROM entity_alias
 WHERE alias = %(raw_name)s AND entity_type = %(entity_type)s
"""
