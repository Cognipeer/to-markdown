#!/usr/bin/env python3
"""One-off authoring helper: builds ground_truth/05_long_report.md from a seeded
sentence pool. The OUTPUT (the .md file) is the committed ground truth; this
script is kept only for provenance. It is deterministic (fixed seed)."""
import random
from pathlib import Path

rnd = random.Random(20261025)

CHAPTERS = [
    ("Network design", ["Hub placement", "Route density", "Seasonal capacity"]),
    ("Fleet operations", ["Vehicle utilisation", "Maintenance cycles", "Driver scheduling"]),
    ("Warehouse performance", ["Inbound handling", "Picking accuracy", "Storage layout"]),
    ("Customer experience", ["Delivery windows", "Claims handling", "Communication channels"]),
    ("Safety and compliance", ["Incident review", "Training programme", "Audit results"]),
    ("Sustainability", ["Emission reduction", "Packaging", "Energy sourcing"]),
    ("Technology platform", ["Order tracking", "Planning software", "Data quality"]),
    ("Workforce", ["Hiring pipeline", "Retention", "Career paths"]),
    ("Finance", ["Cost structure", "Pricing review", "Capital spending"]),
    ("Partnerships", ["Carrier agreements", "Customs brokers", "Technology vendors"]),
    ("Risk management", ["Supply disruption", "Cyber resilience", "Regulatory change"]),
    ("Outlook", ["Strategic priorities", "Investment plan", "Targets for next year"]),
]
OPENERS = [
    "During the year the {a} team focused on {b} and reported steady progress.",
    "A review of {b} showed that {a} results improved by {n} percent compared with last year.",
    "The working group on {a} met {n} times to discuss {b}.",
    "Managers in the {a} area asked for clearer targets on {b}.",
    "Our analysis of {b} found that {a} costs were {n} percent below plan.",
]
MIDDLES = [
    "Regional leads described several practical obstacles, including limited access to {c} and uneven staffing at smaller sites.",
    "Feedback from customers and carriers suggested that better coordination of {c} would reduce delays and rework.",
    "Data from {n} sites showed wide variation, which the team attributed to differences in local processes for {c}.",
    "Several pilots tested new ways of handling {c}, and the lessons were documented for wider use.",
    "Leadership agreed that {c} deserves a dedicated owner and a quarterly progress check.",
]
CLOSERS = [
    "The next review will revisit these findings after {n} weeks of additional measurements.",
    "Action items were assigned and will be tracked on the shared planning board.",
    "No major issues are expected, but the team will monitor the indicators closely.",
    "These results will feed into the budget discussion at the end of the year.",
    "Open questions remain and will be handled in the follow up workshop.",
]
TOPICS = ["dock scheduling", "parcel sorting", "route planning", "returns processing",
          "fuel purchasing", "spare parts", "handover checklists", "load planning",
          "temperature control", "address validation", "customs paperwork", "night shifts"]

def para(a, b):
    n = rnd.randint(3, 97)
    c = rnd.choice(TOPICS)
    return " ".join([
        rnd.choice(OPENERS).format(a=a.lower(), b=b.lower(), n=n),
        rnd.choice(MIDDLES).format(c=c, n=rnd.randint(4, 60)),
        rnd.choice(CLOSERS).format(n=rnd.randint(2, 12)),
    ])

def table(ci):
    rows = ["| Site | Volume | Share | Score |", "| --- | --- | --- | --- |"]
    for s in ["Rotterdam", "Gdańsk", "Lyon", "Bologna", "Malmö", "Porto"]:
        vol = rnd.randint(1200, 98000)
        share = f"{rnd.uniform(2, 31):.1f}%"
        score = "" if rnd.random() < 0.2 else f"{rnd.uniform(2.5, 5):.2f}"
        rows.append(f"| {s} | {vol} | {share} | {score} |")
    return "\n".join(rows)

out = ["# Northwind Logistics Annual Operations Review", "",
       "This review collects the main findings of the operations teams for the past year. "
       "It is intended for senior managers and regional leads, and every chapter ends with "
       "a short list of actions. All figures are internal and unaudited.", ""]
for ci, (title, subs) in enumerate(CHAPTERS, start=1):
    out += [f"## Chapter {ci}: {title}", ""]
    out += [para(title, subs[0]), ""]
    for si, sub in enumerate(subs):
        out += [f"### {sub}", ""]
        out += [para(title, sub), "", para(sub, title), ""]
        if si == 0:
            out += ["- " + rnd.choice(TOPICS).capitalize() + f" reviewed at {rnd.randint(3,40)} sites",
                    "- " + rnd.choice(TOPICS).capitalize() + f" improved by {rnd.randint(2,30)} percent",
                    "- " + rnd.choice(TOPICS).capitalize() + f" costs reduced by {rnd.randint(1,12)} percent",
                    "- " + rnd.choice(TOPICS).capitalize() + f" backlog of {rnd.randint(11,990)} items", ""]
        if si == 1 and ci % 3 == 0:
            out += [f"The table below lists site results for the {title.lower()} chapter.", "", table(ci), ""]
        if si == 2:
            out += [f"Actions agreed for {title.lower()}:", "",
                    f"1. Appoint an owner for {rnd.choice(TOPICS)}",
                    f"2. Publish the updated procedure for {rnd.choice(TOPICS)}",
                    f"3. Report progress to the steering group in week {rnd.randint(2,50)}", ""]
    if ci % 4 == 0:
        out += [f"Further reading is available on the [{title.lower()} page](https://ops.northwind.example/review/chapter-{ci}).", ""]
Path(__file__).parent.joinpath("ground_truth", "05_long_report.md").write_text("\n".join(out), encoding="utf-8")
