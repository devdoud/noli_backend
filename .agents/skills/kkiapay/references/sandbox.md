# KKiaPay sandbox — test data

The sandbox mirrors production without touching a real account. Use the **test API keys** from the dashboard and `sandbox: true` (widget + server SDK). Going live = replace the test keys with the live keys and drop `sandbox`.

## Test mobile money numbers

Pick the number by the scenario to simulate.

**MTN Benin**

| Number | Scenario |
| --- | --- |
| 61000000 / 97000000 | Success |
| 61000001 / 97000001 | Processing error |
| 61000002 / 97000002 | Insufficient fund |
| 61000003 / 97000003 | Payment declined |

**MOOV**

| Number | Scenario |
| --- | --- |
| 68000000 / 95000000 | Success |
| 68000001 / 95000001 | Processing error |
| 68000002 / 95000002 | Insufficient fund |
| 68000003 / 95000003 | Payment declined |

**MTN Côte d'Ivoire** (prefix `225`)

| Number | Scenario |
| --- | --- |
| 2250577100000 / 2250577200000 / 2250577300000 | Success |
| ...100001 / ...200001 / ...300001 | Processing error |
| ...100002 / ...200002 / ...300002 | Insufficient fund |

**Success with delay** (test the wait between init and completion):

| Number | Wait |
| --- | --- |
| 61100000 / 97100000 (MTN BJ), 68100000 / 95100000 (MOOV) | 1 min |
| 61200000 / 97200000 (MTN BJ), 68200000 / 95200000 (MOOV) | 2 min |

## Test cards

Exp `09/32` unless noted, PIN `3310`, OTP `12345`.

**Success**

| Number | CVV |
| --- | --- |
| 5531 8866 5214 2950 | 564 |
| 4556 0527 0417 2643 | 899 |
| 4242 4242 4242 4242 (exp 01/31) | 812 |
| 5399 8383 8383 8381 (exp 10/31) | 470 |

**Failure**

| Number | CVV | Code |
| --- | --- | --- |
| 5258 5891 3014 9016 (exp 11/30) | 887 | transaction_error |
| 5590 1317 4329 4314 (exp 11/32) | 887 | card_fraudulent |
| 5258 5859 2266 6506 (exp 09/31) | 883 | insufficient_fund |
| 5143 0105 2233 9965 (exp 08/32) | 276 | card_declined |
