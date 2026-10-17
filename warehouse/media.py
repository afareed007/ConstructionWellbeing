import json
import subprocess
from fractions import Fraction

from .core import crop_bounds


def run(command, timeout=120):
    try:
        return subprocess.run(command, capture_output=True, timeout=timeout, check=True).stdout
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
        raise ValueError('Video could not be processed. Use a valid MP4 with a visible person.') from None


def probe(path):
    info = json.loads(run(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(path)]))
    streams = [s for s in info['streams'] if s.get('codec_type') == 'video']
    if not streams:
        raise ValueError('The file contains no video stream')
    stream = streams[0]
    duration = float(info['format']['duration'])
    fps = float(Fraction(stream.get('avg_frame_rate') or stream['r_frame_rate']))
    if not 1 <= duration <= 31 or not .5 <= fps <= 120:
        raise ValueError('Use a video between 1 and 30 seconds long, at 1–120 fps.')
    if not 16 <= stream['width'] <= 4096 or not 16 <= stream['height'] <= 2160:
        raise ValueError('Video dimensions must be between 16 pixels and 4K.')
    return {'duration': duration, 'fps': fps, 'width': stream['width'], 'height': stream['height']}


def normalize(source, destination):
    # A known 30 fps geometry makes detection frame indices and track timestamps consistent.
    run(['ffmpeg', '-y', '-nostdin', '-hide_banner', '-loglevel', 'error', '-i', str(source),
         '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1,fps=30',
         '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
         '-movflags', '+faststart', str(destination)])
    return probe(destination)


def crop_window(source, crop, context, track, start, duration, info):
    samples = [s for s in track['samples'] if start <= s['time'] < start + duration]
    if len(samples) < max(10, duration * info['fps'] * .6):
        raise ValueError('Person visibility is too low in this time window')
    boxes = [s['bbox'] for s in samples]
    x, y, width, height = crop_bounds(boxes, info['width'], info['height'])
    common = ['ffmpeg', '-y', '-nostdin', '-hide_banner', '-loglevel', 'error', '-ss', str(start),
              '-i', str(source), '-t', str(duration)]
    encode = ['-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24',
              '-pix_fmt', 'yuv420p', '-movflags', '+faststart']
    run(common + ['-vf', f'crop={width}:{height}:{x}:{y},scale=-2:480'] + encode + [str(crop)])
    run(common + encode + [str(context)])
    return {'crop_box': [x, y, width, height], 'visible_frames': len(samples),
            'window_coverage': min(1, len(samples) / (duration * info['fps']))}


def comparison(reference, current, context, destination):
    command = ['ffmpeg', '-y', '-nostdin', '-hide_banner', '-loglevel', 'error']
    for path in (reference, current, context):
        command += ['-i', str(path)]
    filters = ';'.join(f'[{i}:v]scale=640:480:force_original_aspect_ratio=decrease,pad=640:480:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,setpts=PTS-STARTPTS[v{i}]' for i in range(3))
    filters += ';[v0][v1][v2]concat=n=3:v=1:a=0[comparison]'
    run(command + ['-filter_complex', filters, '-map', '[comparison]', '-an', '-c:v', 'libx264',
                   '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(destination)])


def thumbnail(source, destination):
    run(['ffmpeg', '-y', '-nostdin', '-hide_banner', '-loglevel', 'error', '-i', str(source),
         '-frames:v', '1', '-vf', 'scale=-2:320', str(destination)], timeout=30)
