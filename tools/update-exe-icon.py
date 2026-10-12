"""Stage an icon-only Windows PE update; never overwrite the input executable.

Requires Python 3, Windows and pefile. Refuses signed executables. Verifies all
non-icon resources and non-resource sections before returning a staged output.
"""

import argparse
import ctypes
from ctypes import wintypes
from pathlib import Path
import shutil
import struct

import pefile


def inspect(path):
    pe = pefile.PE(str(path), fast_load=True)
    pe.parse_data_directories(directories=[2])
    resources = {}
    for kind in pe.DIRECTORY_ENTRY_RESOURCE.entries:
        kind_id = str(kind.name) if kind.name else kind.id
        for name in kind.directory.entries:
            name_id = str(name.name) if name.name else name.id
            for lang in name.directory.entries:
                data = lang.data.struct
                resources[kind_id, name_id, lang.id] = pe.get_data(
                    data.OffsetToData, data.Size
                )
    sections = {s.Name: s.get_data() for s in pe.sections if s.Name != b'.rsrc\0\0\0'}
    identity = (pe.FILE_HEADER.Machine, pe.OPTIONAL_HEADER.AddressOfEntryPoint,
                pe.OPTIONAL_HEADER.ImageBase, pe.OPTIONAL_HEADER.Subsystem)
    signed = pe.OPTIONAL_HEADER.DATA_DIRECTORY[4].Size != 0
    overlay = pe.get_overlay()
    pe.close()
    return resources, sections, identity, signed, overlay


def stage(source, icon, output):
    source, icon, output = map(Path, (source, icon, output))
    if output.exists() or source.resolve() == output.resolve():
        raise ValueError('Output must be a new file, distinct from input')
    before = inspect(source)
    if before[3]:
        raise ValueError('Refusing to modify an Authenticode-signed executable')
    groups = [(key, value) for key, value in before[0].items() if key[0] == 14]
    if len(groups) != 1 or not isinstance(groups[0][0][1], int):
        raise ValueError('Expected one numeric icon group')
    group_key, _ = groups[0]
    content = icon.read_bytes()
    reserved, kind, count = struct.unpack_from('<HHH', content)
    if (reserved, kind) != (0, 1) or not count:
        raise ValueError('Invalid ICO header')
    images, entries = [], []
    for i in range(count):
        entry = struct.unpack_from('<BBBBHHII', content, 6 + i * 16)
        width, height, colors, zero, planes, depth, size, offset = entry
        data = content[offset:offset + size]
        if len(data) != size:
            raise ValueError('Truncated ICO payload')
        images.append(data)
        entries.append(struct.pack('<BBBBHHIH', width, height, colors, zero,
                                   planes, depth, size, i + 1))
    group = struct.pack('<HHH', 0, 1, count) + b''.join(entries)
    output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, output)
    api = ctypes.WinDLL('kernel32', use_last_error=True)
    api.BeginUpdateResourceW.argtypes = [wintypes.LPCWSTR, wintypes.BOOL]
    api.BeginUpdateResourceW.restype = wintypes.HANDLE
    api.UpdateResourceW.argtypes = [wintypes.HANDLE, ctypes.c_void_p,
                                   ctypes.c_void_p, wintypes.WORD,
                                   ctypes.c_void_p, wintypes.DWORD]
    api.UpdateResourceW.restype = wintypes.BOOL
    api.EndUpdateResourceW.argtypes = [wintypes.HANDLE, wintypes.BOOL]
    api.EndUpdateResourceW.restype = wintypes.BOOL
    handle = api.BeginUpdateResourceW(str(output.resolve()), False)
    if not handle:
        raise ctypes.WinError(ctypes.get_last_error())
    committed = False
    try:
        for (kind_id, name_id, lang), _ in before[0].items():
            if kind_id in (3, 14):
                if not api.UpdateResourceW(handle, kind_id, name_id, lang, None, 0):
                    raise ctypes.WinError(ctypes.get_last_error())
        lang = group_key[2]
        for i, data in enumerate(images, 1):
            buf = ctypes.create_string_buffer(data)
            if not api.UpdateResourceW(handle, 3, i, lang, buf, len(data)):
                raise ctypes.WinError(ctypes.get_last_error())
        buf = ctypes.create_string_buffer(group)
        if not api.UpdateResourceW(handle, 14, group_key[1], lang, buf, len(group)):
            raise ctypes.WinError(ctypes.get_last_error())
        ending = handle
        handle = None
        if not api.EndUpdateResourceW(ending, False):
            raise ctypes.WinError(ctypes.get_last_error())
        committed = True
    finally:
        if handle:
            api.EndUpdateResourceW(handle, True)
        if not committed:
            output.unlink(missing_ok=True)
    after = inspect(output)
    unrelated = lambda r: {k: v for k, v in r.items() if k[0] not in (3, 14)}
    if (unrelated(before[0]) != unrelated(after[0]) or before[1] != after[1]
            or before[2:] != after[2:]):
        raise ValueError('Non-icon binary content changed; do not deploy staged file')
    if after[0][group_key] != group:
        raise ValueError('Icon group verification failed')
    for i, data in enumerate(images, 1):
        if after[0][3, i, group_key[2]] != data:
            raise ValueError('Embedded icon payload mismatch')
    return count


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source')
    parser.add_argument('icon')
    parser.add_argument('output')
    args = parser.parse_args()
    count = stage(args.source, args.icon, args.output)
    print(f'Verified staged icon update: {count} frames; non-icon content unchanged')
