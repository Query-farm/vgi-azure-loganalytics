"""Fixture lifecycle and chart presentation; JSON typing and analysis stay in SQL."""

from __future__ import annotations

import os
from datetime import timedelta

import matplotlib.pyplot as plt
import seaborn as sns
from IPython.display import Markdown, display

from synthetic_loganalytics_api import END, SyntheticLogAnalyticsApi

SOURCE = "Source: synthetic local Kusto responses · vgi-azure-loganalytics remote 9b7c851 · Haybarn / VGI"


def configure(window_days: int):
    if type(window_days) is not int or not 1 <= window_days <= 7:
        raise ValueError("WINDOW_DAYS must be an integer from 1 through 7")
    end = END
    start = end - timedelta(days=window_days)
    start_iso = start.isoformat().replace("+00:00", "Z")
    end_iso = end.isoformat().replace("+00:00", "Z")
    fixture = SyntheticLogAnalyticsApi().start()
    previous = os.environ.get("NOTEBOOK_LOGANALYTICS_FIXTURE_URL")
    os.environ["NOTEBOOK_LOGANALYTICS_FIXTURE_URL"] = fixture.url
    return fixture, previous, start_iso, end_iso


def cleanup(fixture, previous):
    fixture.stop()
    if previous is None:
        os.environ.pop("NOTEBOOK_LOGANALYTICS_FIXTURE_URL", None)
    else:
        os.environ["NOTEBOOK_LOGANALYTICS_FIXTURE_URL"] = previous


def prose(text: str) -> None:
    display(Markdown(text))


def theme() -> None:
    sns.set_theme(
        style="whitegrid",
        rc={
            "figure.dpi": 145,
            "axes.spines.top": False,
            "axes.spines.right": False,
            "grid.color": "#E8EDE9",
            "text.color": "#243B2F",
            "axes.labelcolor": "#405047",
            "text.parse_math": False,
            "legend.frameon": False,
        },
    )


def chart(fig, title: str, subtitle: str) -> None:
    fig.text(0.08, 0.98, title, ha="left", va="top", fontsize=17, fontweight="semibold")
    fig.text(0.08, 0.91, subtitle, ha="left", va="top", fontsize=10, color="#58685F")
    fig.tight_layout(rect=(0.02, 0.10, 1, 0.83))
    fig.text(0.08, 0.03, SOURCE, fontsize=8, color="#6C7D73")
    plt.show()
