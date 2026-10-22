# What we learned

The client was written from Qloo's docs before a key existed. On October 22, 2026 it met the
live API. This is what that day and the experiments after it taught us, in plain words. The
numbers behind each one, and how they were taken: [QLOO.md](QLOO.md) and
[MEASUREMENTS.md](MEASUREMENTS.md).

## About the taste graph

**1. A reading of the docs held up better than we feared.** Of the thirteen shapes we had
guessed, ten matched the live API, one differed (compare) and was fixed the same day, and two
(rate limits, cache lifetime) are policy that no single call can confirm. The guesses were
written down with how each would be checked, so key day was a checklist, not a scramble.

**2. A stated requirement is a filter, not a signal.** We sent the guest's cuisine as a taste
signal and trusted it to steer. It didn't: none of the top five picks carried the cuisine. As
a hard filter, all of them did. Signals are for preferences. When a guest says "thai", that's
a requirement, and it's encoded as one.

**3. Explainability names entities, never tags.** A band or a film comes back as the driver of a
pick. A cuisine or a mood never does, across every list we checked. So the reason line names
the artist, and any tag it mentions is read from the place's own tag list and said as a fact
("tagged Thai"), never as "fans of".

**4. Scores can be close while ranks are not.** Two people's affinities for the same shortlist sat
within a few hundredths of each other, so a score threshold called every pick a pick for both.
Their ranks disagreed almost everywhere. "Both" now means each person ranks it in their own top
half, and when either person's scores are flat, no pick gets a label rather than a false one.

**5. The top pick isn't the proof; the list is.** With and without taste, the top pick sometimes
matched while the rest of the list moved entirely. Comparing only the top pick would have said
"no difference" when there was one. The contrast compares the whole list, and says so plainly
when the town and the guest agree.

**6. A fuzzy search ranks by spelling, not meaning.** Typo tolerance rescues "thia food", and it
can also rank a near-spelling of a different thing first. Ask for several results and choose the
one whose name matches the word; never trust the first result of a fuzzy endpoint to mean what
you meant.

**7. Scope the question.** The same everyday word returns a place tag, a film genre, or a music
genre depending on what you ask for. Scoping tag search to places turned 4 of 6 right answers
into 6 of 6.

**8. A slow right answer is a wrong answer on the phone.** Naming a town as a signal worked and
took about thirteen seconds. The voice platform waits about ten for a tool. Anything that
slow belongs in a cache, filled ahead of time, or out of the call.

## About building it

**9. A privacy floor must count what it claims to count.** The five-call floor first counted any
call that sent a taste signal, including calls where nothing the guest said resolved and the
server fell back to a generic tag. Five such calls would have opened the panels. A test had
pinned that count, and a test that pins a defect locks it in: the fix had to change the
expectation, not only the code. Now the floor counts calls whose own words resolved.

**10. The defect lives in the handoff.** One tool expanded a chatty mood phrase into a tag per
word, with no cap. The next tool refuses more than eight taste ids. Each was right alone, and
together the agent's next call failed. The limit is now one shared constant, and the test
covers the round trip, not each side.

**11. Test an instrument against the error it really receives.** The battery watched for a 429.
An upstream 429 actually reaches it as a 502 with a `rate_limited` code. The rail built to stop
spending would have kept spending. Tests for a stop signal are written from the response the
instrument sees, not the status it stands for.

**12. "Not applicable" is never the verdict for a tool that was called and failed.** Scoring a
400 as n/a hides the worst result in a run behind the most harmless label. It's a fail.
