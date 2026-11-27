#!/usr/bin/env perl
# For `scripts/coord-merge.sh`: resolves a merge conflict that consists only of `pub mod x;`
# lines (the module list of a crate's lib.rs): both sides are kept, sorted, unique. Exits 1 and
# leaves the file alone if any conflicted line is something else. Keeps the file's line endings
# (CRLF checkouts on Windows).
use strict; use warnings;
my $file = shift or die "usage: resolve-modlist.pl <file>\n";
open my $in, '<', $file or die "$file: $!";
binmode $in;
my @out; my @block; my $in_block = 0; my $eol = "\n";
while (my $line = <$in>) {
    $eol = "\r\n" if $line =~ /\r\n$/;
    (my $bare = $line) =~ s/\r?\n$//;
    if ($bare =~ /^<{7} /) { $in_block = 1; @block = (); next; }
    if ($in_block) {
        next if $bare =~ /^={7}$/ || $bare =~ /^\|{7} /;
        if ($bare =~ /^>{7} /) {
            my %seen; my @mods = sort grep { !$seen{$_}++ } @block;
            push @out, map { "$_$eol" } @mods;
            $in_block = 0; next;
        }
        exit 1 unless $bare =~ /^pub mod [a-z0-9_]+;$/ || $bare eq '';
        push @block, $bare if $bare ne '';
        next;
    }
    push @out, $line;
}
close $in;
exit 1 if $in_block;
open my $o, '>', $file or die; binmode $o; print $o @out; close $o;
exit 0;
