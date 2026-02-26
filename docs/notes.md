# Notes MVP Calixte

## Règles métier

Contexte: `intent=FRAUD_CALLBACK`

| Action         | Décision | Justification |
|----------------|----------|---------------|
| FREEZE_CARD    | STEP_UP  | Action sensible, confirmation client requise |
| ASK_OTP        | DENY     | Pattern de scam/social engineering |
| WIRE_TRANSFER  | DENY     | Non autorisé dans ce scénario |
| DISCUSS_CASE   | ALLOW    | Échange d'information uniquement |

## Signification

- `VERIFIED`: l'interaction est compatible avec un parcours agent légitime.
- `SCAM`: le comportement ressemble à une tentative de fraude.
- `STEP_UP`: contrôle additionnel obligatoire (hors bande).
