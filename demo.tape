# demo.tape: the 30-second demo. Render with `vhs demo.tape` (https://github.com/charmbracelet/vhs).
# It runs the bad sample list, which is refused, then the good one, which ships.

Output demo.gif

Set Shell "bash"
Set FontSize 15
Set Width 1400
Set Height 820
Set Padding 20
Set TypingSpeed 40ms

Type "node gate.mjs sample/bad-list.csv"
Enter
Sleep 5s

Type "ls sample/"
Enter
Sleep 2s

Type "clear"
Enter

Type "node gate.mjs sample/good-list.csv"
Enter
Sleep 5s

Type "head -3 sample/good-list.gated.csv"
Enter
Sleep 4s

Hide
Type "rm -f sample/good-list.gated.csv sample/good-list.receipt.json && clear"
Enter
Show
