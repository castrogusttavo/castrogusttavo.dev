---
title: The price of legally existing before Nexo had a single customer
description: "Before Nexo billed a single real, my co-founder and I had already spent roughly $1,500 just for the company to legally exist — accountant, business-registry fee, city-hall fee, digital certificate. This post breaks down every dollar and every acronym in that process: why we didn't open the Brazilian equivalent of a sole-proprietorship, how we split equity 60/40 with a 48-month vesting schedule, the monthly costs that run before any revenue, and the profitability model that says how many customers cover the whole company — today, zero."
icon: note
date: "2026-08-28"
---

Before Nexo processed a single real customer payment, my co-founder and I
had already spent about **R$8,000 (~US$1,450) just for the company to
legally exist** — half each. That's before a line of code, a marketing
click, or a dollar of infrastructure. It's the cost of becoming a legal
entity before you have any reason to be one.

That number is made of an accountant, two different government fees, a
digital-certificate subscription, and a dozen acronyms I didn't know I'd
need to understand before opening a software company. That's what this
post takes apart: the legal, the equity split, and the finances that come
before — and keep running after — any product. Nexo is the project-management
SaaS I build as founder engineer; the numbers here are its real numbers, not
startup-course estimates. Where the terms are Brazil-specific, I'll name the
closest US/international equivalent so the shape of the problem still
translates.

## The team: two co-founders, one contractor

Nexo has two equity co-founders. I'm the technical founder — architecture,
product, engineering, solo in the codebase since the first commit. My
co-founder handles people, management, and the operational side of the
company. Marketing and sales isn't either founder's job: it's outsourced to
a contracted agency (a separate legal entity, no equity). Three functions,
two equity holders, one vendor.

That split matters for the rest of this post because it changes who owns
each decision. Accountant, government fees, and the digital certificate are
joint calls — legally existing isn't optional for either of us. Marketing
is an approved budget line, not work either founder personally does.

## Why we didn't open a sole-proprietorship

The obvious temptation when starting out is the cheapest, fastest legal
shell — in Brazil that's `MEI` (Microempreendedor Individual), roughly
equivalent to a US sole proprietorship: no mandatory accountant, minimal
paperwork. It doesn't fit here, for two structural reasons, not preference:

- **It's individual by definition.** A sole-proprietorship-equivalent
  doesn't recognize co-founders with equity. To split ownership for real,
  you need an entity type built for partners, not a personal tax ID with a
  business number stapled on.
- **It has a hard revenue ceiling** (currently ~R$81,000/year, about
  US$15,000). A SaaS projecting past R$300,000/year in recurring revenue
  within two years blows past that fast — and migrating regimes mid-flight
  is more friction than registering the right entity from day one.

What we opened instead is an `LTDA` (Brazil's equivalent of an LLC),
classified as `ME` (a small-business revenue bracket under the simplified
tax regime, not a legal entity type in itself — that distinction cost me
real confusion before I opened the company). The primary business-activity
code we registered is the one for off-the-shelf, non-customizable software
licensing — the code that matches a subscription SaaS. Secondary codes cover
customizable software and data hosting, so we're not uncovered if the
business model shifts shape.

## The cost of opening: registry, city hall, accountant

In the budget we built before the company existed, we projected R$800-1,500
(~US$145-270) for business-registry fees plus the accountant's setup
service. In practice, what we paid separately was **R$220 for the business
registry fee** and **R$200 for the city-hall operating-license fee** — the
rest of that range is the accountant's own service fee for handling the
registration, billed apart from the recurring monthly fee.

| Item | Cost | When |
| --- | --- | --- |
| Business registry fee | R$220 (~US$40) | At founding |
| City-hall license fee | R$200 (~US$36) | At founding |
| Accountant's setup service | Rest of the R$800-1,500 range | At founding |
| Recurring accounting | R$250/month (~US$45) | Every month, indefinitely |

Outside the direct legal cost, the rest of the ~R$8,000 initial contribution
(~R$4,000 per founder) covered trademark registration, six months of
working capital to keep the minimum toolset running, and a contingency
reserve. That's the number that matters when someone asks "how much does it
cost to start": not R$240,000 in accelerator funding — **R$8,000, once,
split two ways.**

## Accounting and digital signature: the bills that don't stop

Nexo's accounting runs through a direct accountant — a self-employed
professional we hired, with no online accounting platform sitting in
between. In practice that means direct email and messaging with the person
handling it, not a platform support queue.

Beyond his monthly fee (R$250), there's a second recurring
bill nobody mentions before opening a company: `e-CPF`, a digital-signature
certificate subscription at R$49.90/month (~US$9). It signs tax documents
and authenticates on government portals on the founder's behalf — without
it, the accountant can't file or transmit most of the company's obligations.

The tax regime is `Simples Nacional` (Brazil's simplified small-business tax
framework), and inside it, the bracket is decided by a formula called
`Fator R`:

```
Fator R = trailing 12-month payroll (owner draw + charges) ÷ trailing 12-month gross revenue
```

A Fator R of **28% or higher** puts you in the cheaper bracket (`Anexo III`);
below that, a more expensive one (`Anexo V`). Early on, with annual gross
revenue under R$180,000, clearing that bar is trivial: **R$2,300/month in
owner draw alone locks in the 6% rate.** At higher revenue, maintaining that
ratio gets expensive enough that it stops making sense — it's a calculation
you redo at every revenue tier, not a decision you make once. The legal
minimum owner draw is one minimum wage per founder, with 11% withheld for
social security.

## The split: dividing a company that doesn't earn anything yet

The most expensive part of the founding conversation wasn't any of the
above — it was deciding how much equity each founder holds in a company
that doesn't bill anyone yet. We used an explicit weighted framework instead
of "split it down the middle" or "whoever had the idea gets more":

| Factor | Weight | What it measures |
| --- | --- | --- |
| Original idea/concept | 5% | Who brought the thesis |
| Product already built (sunk work) | 20% | Foundation already in production, built solo |
| Future commitment (hours/week) | 30% | What each founder delivers over the next 18 months |
| Risk taken on (capital, leaving a job) | 20% | Who puts in money, who gives up income first |
| Irreplaceable critical skill | 20% | Does the business stop without this person? |

The result was **60/40 toward the technical side** — driven mostly by the
product already built solo before the formal partnership existed. That
split isn't what actually protects the company, though. The articles of
incorporation are the minimum public record; what protects you is the
**founders' agreement**, a private document with the clauses that matter
when things go wrong:

- **48-month vesting, 12-month cliff** — leave before a year and you get
  zero equity; after that, monthly acquisition. Vesting is **reverse**:
  shares are issued upfront in the contract, but the company buys back the
  unvested portion for a token amount if someone leaves early.
- **Acceleration**: single-trigger 50% on a company sale; double-trigger
  (sale + termination without cause) 100%.
- **Full, irrevocable IP assignment** — all code, brand, domain, and content
  belongs to the legal entity, never to a person. It's the single most
  important clause in the document: without it, a departing founder walks
  out with the product.
- **Deadlock**: a controlling vote plus a shotgun clause — one founder names
  a price for the company, the other decides whether to buy or sell at that
  same price.

Money either founder puts into the company goes in as a **loan**, not a
capital increase: it's registered debt, repaid first when cash allows, and
— the key point — **it doesn't touch the split**. If it went in as capital,
every uneven contribution would reopen the ownership conversation. As a
loan, the money just comes back.

Spending has explicit sign-off thresholds, so it doesn't turn into an
informal group-chat decision:

| Amount | Who approves |
| --- | --- |
| Up to R$500/month (~US$90) | Either founder, alone, in their own area |
| R$500-2,000/month | Notify the other, 24h to veto |
| Above R$2,000 or any annual contract | Both, in writing |

## The acronyms worth learning

None of these show up in a programming course, and all of them showed up in
my inbox within Nexo's first few months.

**Legal and tax:**

| Term | What it is |
| --- | --- |
| `LTDA` | Brazil's limited-liability entity type — roughly an LLC |
| `ME` | Small-business revenue bracket (up to ~R$360k/year), not an entity type |
| `MEI` | Individual-only regime with a hard revenue ceiling (~R$81k/year) |
| CNAE | The code that classifies a company's economic activity for the government |
| `e-CPF` | Digital certificate that signs tax filings and authenticates on government portals |
| Simples Nacional | Brazil's simplified tax regime for small businesses |
| `Fator R` | Formula deciding which Simples Nacional bracket applies, based on payroll-to-revenue ratio |
| INPI | The office that registers trademarks — without it, a company name has no legal protection |

**Finance and growth:**

| Term | What it is |
| --- | --- |
| `MRR` | Monthly recurring revenue |
| `ARR` | Annual recurring revenue (MRR × 12) |
| `ARPU` | Average revenue per user/seat |
| `CAC` | Customer acquisition cost |
| `LTV` | Projected value a customer generates over their lifetime |
| `EBITDA` | Earnings before interest, taxes, depreciation, and amortization |
| `COGS` | Direct cost of delivering the product (infra, embedded AI, payment gateway) |
| `ICP` | Ideal customer profile |
| `TAM/SAM/SOM` | Total addressable market / serviceable market / market actually capturable |
| `PMF` | Product-market fit — real customers using, retaining, and referring, not just the founder's own validated pain |

## Recurring costs: what goes out every month before any revenue

Separate from the legal side, there's the technical and marketing operation
running in parallel — each line with its own bill, even with zero paying
customers so far:

| Item | Monthly cost | Category |
| --- | --- | --- |
| Accounting | R$250 (~US$45) | Legal |
| e-CPF | R$49.90 (~US$9) | Legal |
| Domain (R$180/year) | ~R$15 (~US$3) | Infra |
| Resend (US$20) | ~R$110 | Infra |
| VPS hosting (Hostinger, top tier) | R$120 (~US$22) | Infra |
| GitHub Pro (US$4) | ~R$22 | Infra |
| Marketing | R$400-1,000 (~US$70-180) | Growth |
| Events/talks (R$400-700 every 2-3 months) | ~R$150-280 average (~US$27-50) | Growth |

Adding the low and high ends, Nexo's recurring monthly cost today sits
between **R$1,117 and R$1,867** (~US$200-340) — before owner draw, before
any hire, before a single real of customer revenue covers any of it. That's
the number every technical founder should know by heart before deciding
"we're ready to launch."

## The profitability model: how many customers cover the company

The model below is **planning, not a measured result** — Nexo doesn't have
real paying customers yet. Same caveat I'd apply to any projected number on
this blog: cite the source, don't inflate the reach.

The payment gateway (AbacatePay, a Brazilian processor) charges very
different fees by method: Pix (Brazil's instant-payment rail) costs a flat
R$0.80 (~0.10% on a R$812 average ticket); credit card costs 3.5% + R$0.60
(~3.57% on the same ticket). At a 70% Pix / 30% card mix, blended gateway
fees land around **~1.14%**.

The modeled gross margin is **80%**, with direct cost (infra + embedded AI)
around **20%** — capped by a hard per-seat AI cost ceiling, because without
one a handful of heavy users wrecks the entire plan's margin. In this model,
contribution margin per customer is **R$592/month** (~US$107).

Breakeven isn't a date here — it's a ladder, unlocked by paying customers,
not the calendar:

| Rung | Fixed cost/month | Customers | MRR |
| --- | --- | --- | --- |
| Company breaks even (minimal toolset) | R$607 (~US$110) | **2** | R$1.6k |
| Full stack | R$1,271 (~US$230) | **3** | R$2.4k |
| One founder full-time | R$6,271 (~US$1,140) | **11** | R$8.9k |
| Both founders full-time | R$11,271 (~US$2,050) | **20** | R$16.2k |
| Both + marketing budget | R$13,271 (~US$2,410) | **23** | R$18.7k |
| First hire | R$21,271 (~US$3,870) | **36** | R$29.2k |

**Two customers cover the entire company today.** That's the number that
changes the conversation whenever someone assumes starting a startup
requires accelerator-scale capital — it doesn't take R$240,000, it takes
two customers.

In the model's base scenario (100 customers, R$812 ARPU, R$81,200 MRR), the
cascade down to EBITDA looks like this:

| Line | % | R$/month |
| --- | --- | --- |
| Gross revenue (MRR) | 100% | 81,200 |
| (–) Gateway fee | 1.14% | (926) |
| (–) Taxes (Simples, lower bracket) | 12.34% | (10,020) |
| (–) COGS: infra + AI | ~20% | (16,240) |
| **= Gross profit** | **~66%** | **54,014** |
| (–) Owner draw (2 founders) | — | (10,000) |
| (–) Tooling | — | (1,271) |
| (–) Marketing/GTM | — | (2,000) |
| **= EBITDA** | **~50%** | **40,743** |

That 100-customer scenario is a target, not a measurement — same as the
projected ~R$153 million/year Brazilian startup market (17,000 companies ×
average annual ticket) and the 50-150 customer goal within 18 months.
Churn (2%-6% monthly) and CAC today are market benchmarks, not observed
numbers — turning those into real measurements is next months' work, not
something that's already happened.

Since Nexo builds in public, it's worth showing the full projection, not
just the base scenario. The model runs three cases — conservative, base,
optimistic — varying customers at the 18-month mark (SOM), CAC, and churn:

| Metric | Conservative | Base | Optimistic |
| --- | --- | --- | --- |
| Customers at 18mo (SOM) | 50 | 100 | 150 |
| CAC | R$720 (~US$130) | R$360 (~US$65) | R$240 (~US$44) |
| Monthly churn | 6% | 4% | 2% |
| Average customer lifetime | 16.7 months | 25 months | 50 months |
| LTV (ARPU × 80% × lifetime) | R$7,225 (~US$1,310) | R$16,240 (~US$2,950) | R$47,200 (~US$8,580) |
| LTV:CAC | ~10:1 | ~45:1 | ~197:1 |
| CAC payback | 1.7 months | 0.55 months | 0.25 months |
| MRR | R$27,050 | R$81,200 | R$177,000 |
| ARR | R$324,600 (~US$59k) | R$974,400 (~US$177k) | R$2,124,000 (~US$386k) |

Every LTV:CAC in that table is inflated because it assumes near-zero
CAC — founder-led, organic acquisition scaling all the way to 150
customers, which isn't sustainable indefinitely. Running the same base
scenario with a traditional paid-acquisition CAC (R$2,500) changes the
picture but it's still healthy:

| Metric | Base scenario, CAC R$2,500 |
| --- | --- |
| LTV | R$16,240 |
| LTV:CAC | 6.5:1 |
| Payback | 3.9 months |

6.5:1 is still above the 3:1 market benchmark — that's the number to cite
if the question is "what if organic doesn't scale?"

## What this number proves, and what it doesn't

It proves legally existing has a fixed, knowable price: ~R$8,000 to open,
R$1,100-1,900/month to run, and a handful of acronyms worth learning before
you need them under deadline pressure. It proves the real financial risk of
starting a software startup with a co-founder is orders of magnitude smaller
than R$240,000 in funding — it's the size of two customers paying enough to
cover the minimum operation.

It doesn't prove Nexo will find product-market fit. It doesn't prove 60/40
was the right split, only that it's what we decided with the framework we
had. It doesn't prove the optimistic scenario's R$1.3 million ARR will
happen — that number is a planning target, written before the first
customer, not after. What opening the company proves is narrower and less
exciting than any pitch: that you can legally exist, with a co-founder,
with an accountant, with the right acronyms, spending less than most
technical founders imagine — and that none of it replaces having a customer
willing to pay.
