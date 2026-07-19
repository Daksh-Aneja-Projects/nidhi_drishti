"""Pure parsing helpers. No network, no database, no configuration.

Everything in this package is a function of its arguments, which is what makes
the test suite able to cover the cases that actually matter: a rupee figure with
no unit, a fiscal quarter that starts in April, a cumulative CGA range that
crosses new year.
"""
