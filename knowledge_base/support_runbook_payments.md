# Support Runbook: Payment Issues

## Objective

Help support explain payment failures and identify cases that require manual review.

## Payment status meanings

### pending

The payment was initiated but has not received a final result yet.

### completed

The payment succeeded.

### failed

The payment did not succeed.

### reversed

A temporary authorization or capture was reversed.

## Common decline sources

NimbusPay can identify some broad decline categories:

- insufficient_funds
- bank_declined
- authentication_failed
- card_expired
- risk_block

The issuing bank may provide only a generic decline.

## Recommended support flow

1. Check current payment status.
2. Check whether there are multiple recent attempts for the same amount.
3. Check whether the card is expired or recently reissued.
4. If status is pending for less than 30 minutes, advise the user to wait.
5. If duplicated charge is reported, determine whether it is a duplicate authorization or two separate completed payments.

## Escalation criteria

Escalate to human support if:

- payment remains pending for more than 24 hours
- two completed charges exist for the same purchase
- the refund window has passed but reversal is still missing
