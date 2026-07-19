"""Nidhi Drishti ingestion layer.

One module per public source under :mod:`pipelines.sources`, a shared spine
under :mod:`pipelines.lib`, and unit-testable parsers under
:mod:`pipelines.parsers`.

Two rules govern everything in this package:

1. No number reaches the canonical store without a ``source_record`` row that
   names the URL, the content hash of the raw artifact and the fetch time.
2. A source that changed shape produces a drift alert and aborts, rather than
   writing whatever the new shape happened to parse into.
"""

__all__ = ["__version__"]

__version__ = "0.1.0"
