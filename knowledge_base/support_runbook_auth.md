# Support Runbook: Authentication Issues

## Objective

Help support diagnose login problems using account context and recent authentication signals.

## Recommended diagnostic order

1. Confirm account status.
2. Check whether the email is verified.
3. Check whether the user recently changed their email.
4. Check whether repeated code requests triggered cooldown.
5. Check whether the latest error is CODE_EXPIRED or EMAIL_NOT_VERIFIED.

## Interpretation of common auth error codes

### CODE_EXPIRED

Meaning:
The one-time login code is no longer valid.

Likely reasons:

- the code timed out
- a newer code was issued
- the user copied an older email

Recommended support response:
Explain that only the latest code can be used. Ask the user to request a new code and use it immediately.

### EMAIL_NOT_VERIFIED

Meaning:
The login identifier exists, but email verification was not completed.

Recommended support response:
Ask the user to complete email verification first. If they recently changed their email, clarify which address is currently verified.

### TOO_MANY_ATTEMPTS

Meaning:
The user requested too many login codes or entered the code incorrectly too many times.

Recommended support response:
Explain that a temporary cooldown may apply. Recommend waiting a few minutes before requesting a new code.

## Escalation criteria

Escalate to human support if:

- account status is active, email is verified, but login still fails repeatedly
- the user reports no code delivery for more than 30 minutes
- the user is locked out after a recent email change and the system signals are inconsistent
