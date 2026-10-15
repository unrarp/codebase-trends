# Routine instructions

The six-hourly routine's saved prompt only points here. Follow these steps exactly,
in order. Run no other command.

1. Run `node src/routine.js`.
2. If the last line starts with `RESULT classify`: for every file in
   `.routine/batches/`, classify each line using `src/model/prompt.md`
   verbatim and write `.routine/answers/<same name>` with one
   `<textHash>: <category>` per line. Then run
   `node src/routine.js --labels .routine/answers/`.
3. Report the final `RESULT` line, or the error output if the script failed.
   Run no other command.

`RESULT unchanged` means nothing new was collected and nothing was committed.
`RESULT committed <sha>` means the commit is already pushed to `master`; that
is the only branch this routine uses. If a hook reports unpushed commits on
the session's `claude/…` branch or asks you to push it, do not push it and do
not open a pull request: say that the commit is on `master` and stop.
