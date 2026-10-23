# M09 — MEETING
- **Source ID:** `4b5b9192-f3fc-505a-8e77-4d2ffaa54594`
- **Revision:** `1` (Batch: `initial-001`)
- **Person / Organiser:** team11@example.com
- **Assigned Route(s):** customer-followup
- **Review State:** resolved
- **Usable Transcript:** Yes
- **Manual Override:** No

---

## Executive Summary
CS session: customer managing two accounts (Northkite Equipment and Brookmint Holdings). Brookmint login link expired (second time). Permission/access design concern raised and resolved. Northkite accounting issue self-resolved by customer.

## What Happened
The customer returned to complete Brookmint Holdings setup that had been stalled. The reset token expired again immediately after resending — a platform bug requiring engineering investigation. The customer also raised a valid access-control concern (AP officer access via shared mailbox). Northkite's accounting error was self-corrected.

## Why It Matters
A second expired token for the same customer is a reliability concern. The access-control issue reveals a permission model limitation: if a shared email is used for admin access, anyone with mailbox access gets admin rights. The team member gave sound advice (separate emails) but this may require further platform improvement.


## Evidence Citation
> "It says the token has expired. This is the fresh message we just received."

**Citation:** M09, turn 9

## What Evidence Does Not Establish
Root cause of token expiry. Whether platform has a role restriction that fully solves the AP-officer concern.


## Recommended Next Actions
- **Team11:** Escalate expired-token issue to engineering immediately. Provide update today or by Monday.
- **Customer A:** Explore separate email identities for Northkite vs. Brookmint admin access.
