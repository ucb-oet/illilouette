#!/usr/bin/env python3
"""Builds test/fixtures: waterfall files that Chipyard's `eventtrace waterfall` writes from Sodor's traces, and, for
the smaller ones, the same files as JSON, read back with the protobuf package, which the decoder's test compares
against. Needs cargo, to build the reader, and protoc, to compile the schema for the protobuf package.

  uv run --with protobuf scripts/make_fixtures.py <chipyard>
"""
import json
import os
import subprocess
import sys
import tempfile

from google.protobuf import descriptor_pb2, message_factory

chipyard = os.path.abspath(sys.argv[1])
reader = os.path.join(chipyard, 'tools/eventtrace/reader')
here = os.path.dirname(os.path.abspath(__file__))
proto = os.path.join(here, '..', 'proto')
out = os.path.join(here, '..', 'test', 'fixtures')
sodor = 'chipyard.harness.TestHarness.TracedSodor5StageConfig'
manifest = f'{chipyard}/sims/verilator/generated-src/{sodor}/{sodor}.eventtrace.json'
traces = f'{chipyard}/sims/verilator/output/{sodor}'
view = f'{reader}/sodor/view.json'

subprocess.run(['cargo', 'build', '--release', '--quiet', '--manifest-path', f'{reader}/Cargo.toml'], check=True)
eventtrace = f'{reader}/target/release/eventtrace'

with tempfile.NamedTemporaryFile() as descriptors:
    subprocess.run(['protoc', f'--proto_path={proto}', f'--descriptor_set_out={descriptors.name}', 'waterfall.proto'],
                   check=True)
    files = descriptor_pb2.FileDescriptorSet.FromString(descriptors.read()).file
Waterfall = message_factory.GetMessages(files)['illilouette.Waterfall']


def plain(w):
    """The file as JSON with every field present, the shape the viewer's decoder returns."""
    def field(f):
        return {'name': f.name, 'text': f.text, 'row': f.row if f.HasField('row') else None}

    def event(e):
        effect = e.WhichOneof('effect')
        return {'cycle': e.cycle, 'site': e.site,
                'effect': {'kind': effect, 'stage': e.enters} if effect == 'enters' else {'kind': effect},
                'fields': [field(f) for f in e.fields]}

    def row(r):
        return {'type': r.type, 'id': r.id, 'label': list(r.label),
                'segments': [{'from': getattr(s, 'from'), 'stage': s.stage, 'held': s.held} for s in r.segments],
                'end': r.end if r.HasField('end') else None, 'endedBy': r.ended_by, 'normalEnd': r.normal_end,
                'fields': [field(f) for f in r.fields], 'events': [event(e) for e in r.events]}

    return {'version': w.version, 'title': w.title, 'firstCycle': w.first_cycle, 'lastCycle': w.last_cycle,
            'strings': list(w.strings),
            'sites': [{'event': s.event, 'instance': s.instance, 'source': s.source} for s in w.sites],
            'types': [{'name': t.name, 'stages': list(t.stages)} for t in w.types],
            'rows': [row(r) for r in w.rows]}


for name, keep_json in [('rv32ui-p-add', False), ('rv32mi-p-illegal', False),
                        ('rv32ui-p-add.from-0x80000000', True), ('rv32ui-p-add.cycle-48079-to-flush', True)]:
    pb = os.path.join(out, f'sodor-{name}.waterfall.pb')
    subprocess.run([eventtrace, 'waterfall', view, manifest, f'{traces}/{name}.trace', pb], check=True)
    if keep_json:
        w = Waterfall.FromString(open(pb, 'rb').read())
        json.dump(plain(w), open(pb.replace('.waterfall.pb', '.expected.json'), 'w'), separators=(',', ':'))
    print(name, os.path.getsize(pb), 'bytes')
