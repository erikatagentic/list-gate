<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/banner-dark.png">
  <img alt="list-gate: A check that refuses to ship a bad lead list." src=".github/banner-light.png">
</picture>

# list-gate

A check that refuses to ship a bad lead list. It writes nothing and exits with an error when the list is wrong.

[The story behind it on erikhernal.com](https://erikhernal.com/work/last-mile/?utm_source=github)

## The problem

Bad lead lists don't look bad, because every row reads fine on its own. Here are three real cases I hit, with the clients taken out.

**The comma bug.** A script pulled the domain column out of a CSV by splitting each line on commas. Company names like "Acme, Inc" shifted every later column by one. It lost 151 of 1,268 domains (12%), and the run still reported success.

**The clustered size column.** A list came back where 47 of 50 rows had a company size between 300 and 310, right on the search filter's floor of 300.

That's the shape of a "300 or more, smallest first, take 50" pull. Either the figures were junk or the list didn't cover the range it was pitched on, and no single row looked wrong.

**The drifted copies.** Four hand-written copies of the matching logic had each drifted a little. The same company got different keys in different jobs, so duplicates got through with no error.

## What it does

- Reads a CSV with a small header alias map, so a column called `Work Email` reads as `email`.
- Drops any row missing an email, first name, last name, full name, company or company domain, and says why.
- Fails the run when a row has more or fewer fields than the header.
- Dedups on email, LinkedIn URL, and the same name at the same root domain, using one shared matching-key module. The display name ships as `company_name_clean` next to the raw company field.
- Drops rows that match an optional `--suppress` file of emails and domains.
- Tags free-mail and role addresses (`info@`) in an `email_flags` column. It never drops them.
- Classes each email domain by mail server: google, microsoft, other, none or lookup-failed. A row whose lookup failed is held out of the list, never passed.
- Runs four whole-list checks, and each one is a hard failure: a size column clustered at a floor, one domain owning too many rows, a column blank on most rows, and domains in versus domains classed not adding up.
- Writes nothing when any hard check fails.

When every check passes it writes `<name>.gated.csv` and `<name>.receipt.json`. The receipt holds the input's hash and the row counts in and out. It also lists each check's result, plus every dropped or held row with its reason.

## Demo

<!-- demo.gif goes here. Render it with: vhs demo.tape -->

## Run it yourself

You need Node 22 or newer. There are no dependencies.

```sh
node gate.mjs sample/bad-list.csv     # refused: prints what failed, exits 1, writes nothing
node gate.mjs sample/good-list.csv    # passes: writes the cleaned list and a receipt
npm test
```

The sample lists are made up, and every domain ends in `.example`.

The bad list fails for reasons you won't spot by eye. Its size column is clustered at 300. Row 37 also repeats row 6's person under a capitalized email, and one domain's mail-server lookup fails.

Mail-server lookups come from `sample/mx-fixture.json`, so the demo makes no network calls. Pass `--live-dns` to use real DNS, or add `--suppress sample/suppress.csv` to the good list to see suppression drop four rows.

## One real result

This is the comma bug, replayed. `test/sanity.test.mjs:66` pulls four domains out of a small CSV the old way, by splitting on commas, and classes whatever comes out.

Two of the four company names hold a comma, so only two domains survive. The domain count check fails with `4 domains in, 2 classed` and names the two it lost, where the old run would have called it a success.

## Where it came from

Pulled out of a private repo on 2026-11-25. The history stays private because it holds client data. The sample data is made up.

The private version also re-checks people and companies against live sources. Those checks cost money per row, so they aren't here.

## Contact

erik@erikhernal.com

## License

MIT. See [LICENSE](LICENSE).
