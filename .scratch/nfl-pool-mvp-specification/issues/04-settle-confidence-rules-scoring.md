Type: grilling
Status: resolved
Blocked by: 01

# Settle confidence rules and scoring semantics

## Question

What exact MVP rulebook should govern a weekly Confidence Pick Set and its results, including required games, confidence-value ranges and uniqueness, partial or missing submissions, points, weekly and season ranks, ties in the standings, and possible-points calculations?

## Answer

### Required slate, scale, and default ranking

- Every synchronized NFL regular-season game in the Pool Week is a Required Confidence Game. Pool Owners cannot omit games.
- The Confidence Scale ends at the maximum possible number of NFL games in one regular-season week for the Pool Season. Under the current 32-team format that maximum is 16; it is a derived season rule rather than a permanently hardcoded league assumption.
- A week with `N` required games uses the highest `N` values from that scale, each exactly once. With a maximum of 16, a 14-game week uses 3 through 16.
- Every Pickable Week has one Pick Sheet order, frozen when its Pick Window opens and identical for every participant. Games sharing a kickoff retain their relative Pick Sheet order.
- Every Confidence Pick Set begins with the Default Confidence Ranking: the scale's maximum goes to the first Pick Sheet game, then values descend game by game. Participants may reorder the values while the applicable Pick Locks permit.

### Predictions, omissions, and points

- Confidence predictions are straight-up winner selections. A correct prediction earns its assigned confidence value; an incorrect prediction earns zero. The separate [Define disrupted and corrected game policy](./07-define-disrupted-corrected-game-policy.md) decision governs tied, canceled, postponed, rescheduled, or corrected games.
- Every required game always has one unique assigned value, even while its winner prediction is blank.
- A participant-started set may remain incomplete. Each game that locks without a valid winner prediction earns zero; every other valid prediction scores normally, and the participant remains in the Weekly Standing.
- If the first Required Confidence Game locks while a participant has submitted no winner predictions for that Pool Week, the system creates an Automatic Confidence Pick Set: it predicts every home team and retains the Default Confidence Ranking. Those predictions then score like participant-authored predictions and contribute to the Season Standing.
- The precise initialization, edit, and lock behavior for default and automatic sets belongs to [Define pick submission, locking, and visibility](./05-define-pick-submission-locking-visibility.md).
- Weekly points are the sum of confidence values earned from correct predictions. Correct-pick count may be displayed as information but never changes points or rank.

### Possible points

- Possible Remaining Points are the confidence values the participant can still legally earn in the unresolved Pool Week.
- They include values attached to unresolved valid predictions and values still achievable by submitting a valid prediction for an unlocked game.
- They exclude values for games that locked without a valid prediction and predictions already known to be incorrect.
- Maximum Possible Weekly Points are the participant's points already earned plus Possible Remaining Points.

### Weekly ranking and tiebreaker

- Weekly Standings order participants first by weekly points, highest first.
- Equal weekly point totals are ordered by a Weekly Tiebreaker Prediction: a whole number from 0 through 200 inclusive predicting the two teams' combined final points in the chronologically last scheduled Required Confidence Game.
- Smaller absolute prediction error ranks ahead. If two predictions are equally distant, the prediction below the actual total ranks ahead of the prediction above it.
- Any valid Weekly Tiebreaker Prediction ranks ahead of an omitted one. Participants with the same remaining tiebreaker result, including joint omissions, share a competition rank such as 1, 2, 2, 4.
- The disrupted-game decision governs what happens if the designated tiebreaker game is rescheduled, canceled, or otherwise does not yield the expected Verified Result.

### Season ranking and completion

- Season points are the sum of every Weekly Standing point total from the Pool's Start Week through Week 18. Weeks are neither dropped nor normalized; an untouched week contributes the points earned by its Automatic Confidence Pick Set.
- Equal season point totals share a competition rank. Weekly tiebreakers award no bonus points and never break a Season Standing tie.
- A Confidence Pool becomes Completed only after every Week 18 Required Confidence Game has a Verified Result and Week 18 has been successfully scored.
- Every participant tied for the highest final Season Standing point total is a Confidence Winner, so the Pool may have one winner or joint winners.
