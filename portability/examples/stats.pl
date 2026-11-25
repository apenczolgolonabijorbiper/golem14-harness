#!/usr/bin/env perl
# Independently implemented from specs/MEMORY.sudo.md; no reference source imports.
# Demonstrates one operation only. Requires target Perl with its core JSON::PP module.
use strict;
use warnings;
use JSON::PP;
use Encode qw(decode encode);
my $codec = JSON::PP->new->utf8->canonical;
while (my $line = <STDIN>) {
  my $request = $codec->decode($line);
  my $response;
  eval {
    die "Only stats is implemented" unless $request->{operation} eq 'stats';
    my $i=$request->{input}; my $g=$i->{graph};
    my %processed=map { my $s=$i->{sources}{$_->{id}}; ($s && $s->{sha256} eq $_->{source_sha256}) ? ($_->{id}=>1) : () } @{$i->{ledger}{observations}};
    my %days;
    my $add=sub {my ($at,$key)=@_;my $d=substr($at,0,10);$days{$d} //= {day=>$d,observations=>0,entities=>0,claims=>0,relations=>0};$days{$d}{$key}++;};
    $add->($_->{recorded_at},'observations') for values %{$i->{sources}};
    $add->($_->{created_at},'entities') for @{$g->{entities}};
    my ($relations,$active,$open)=(0,0,0);
    for (@{$g->{claims}}) {$add->($_->{created_at},'claims');if ($_->{object}{entity_id}) {$add->($_->{created_at},'relations');$relations++;}$active++ if $_->{status} eq 'active';}
    for (@{$i->{queue}{questions}}) {$open++ if $_->{status} eq 'open';}
    my %cumulative=(observations=>0,entities=>0,claims=>0,relations=>0);
    my @timeline;
    for my $d (sort keys %days) {for my $k (keys %cumulative) {$cumulative{$k}+=$days{$d}{$k};}push @timeline,{%{$days{$d}},cumulative=>{%cumulative}};}
    my $observations=scalar keys %{$i->{sources}};
    my $result={capacity=>{sources=>{used=>scalar @{$g->{sources}},limit=>10000},entities=>{used=>scalar @{$g->{entities}},limit=>5000},claims=>{used=>scalar @{$g->{claims}},limit=>20000}},totals=>{observations=>$observations,processed=>scalar keys %processed,pending=>$observations-scalar(keys %processed),entities=>scalar @{$g->{entities}},claims=>scalar @{$g->{claims}},relations=>$relations,active_claims=>$active,open_questions=>$open},timeline=>\@timeline,graph_updated_at=>$g->{updated_at},definitions=>{relations=>'Claims whose object references an entity; a subset of claims, including retained correction history.',timeline=>'UTC recording date for observations; actual graph creation date for entities/claims. Migration does not invent earlier graph growth.'}};
    $response={id=>$request->{id},result=>$result};
  };
  $response={id=>$request->{id},error=>"$@"} if $@;
  print $codec->encode($response)."\n";
}
