/**
 * Names that exist without being declared: Python's built-ins, JavaScript's
 * globals, and what the most used Python modules contain (for `from turtle
 * import *`, `math.sqroot` → «mente du sqrt?», and «har du glemt import?»).
 */

const words = (s: string) => s.trim().split(/\s+/);

export const pythonBuiltins = new Set(
  words(`
  abs aiter all anext any ascii bin bool breakpoint bytearray bytes callable chr classmethod compile complex
  copyright credits delattr dict dir divmod enumerate eval exec exit filter float format frozenset getattr
  globals hasattr hash help hex id input int isinstance issubclass iter len license list locals map max
  memoryview min next object oct open ord pow print property quit range repr reversed round set setattr slice
  sorted staticmethod str sum super tuple type vars zip __import__ __build_class__ __debug__
  NotImplemented Ellipsis
  BaseException BaseExceptionGroup Exception ExceptionGroup ArithmeticError AssertionError AttributeError
  BlockingIOError BrokenPipeError BufferError BytesWarning ChildProcessError ConnectionAbortedError
  ConnectionError ConnectionRefusedError ConnectionResetError DeprecationWarning EOFError EncodingWarning
  EnvironmentError FileExistsError FileNotFoundError FloatingPointError FutureWarning GeneratorExit IOError
  ImportError ImportWarning IndentationError IndexError InterruptedError IsADirectoryError KeyError
  KeyboardInterrupt LookupError MemoryError ModuleNotFoundError NameError NotADirectoryError
  NotImplementedError OSError OverflowError PendingDeprecationWarning PermissionError ProcessLookupError
  PythonFinalizationError RecursionError ReferenceError ResourceWarning RuntimeError RuntimeWarning
  StopAsyncIteration StopIteration SyntaxError SyntaxWarning SystemError SystemExit TabError TimeoutError
  TypeError UnboundLocalError UnicodeDecodeError UnicodeEncodeError UnicodeError UnicodeTranslateError
  UnicodeWarning UserWarning ValueError Warning WindowsError ZeroDivisionError
  __name__ __file__ __doc__ __builtins__ __spec__ __loader__ __package__ __annotations__ __path__
  __qualname__ __module__ __class__ __dict__ _IncompleteInputError
`),
);

/** Built-ins beginners often use as variable names by accident. */
export const pythonShadowable = new Set(
  words(`
  abs all any bool chr dict dir enumerate eval exec filter float format hash help id input int iter len list
  map max min next object open ord pow print range reversed round set sorted str sum tuple type vars zip
`),
);

/** Module contents, for `from m import *` and checking `m.name`. Only modules listed completely. */
export const pythonModules: Record<string, Set<string>> = {
  math: new Set(
    words(`
    acos acosh asin asinh atan atan2 atanh cbrt ceil comb copysign cos cosh degrees dist e erf erfc exp exp2
    expm1 fabs factorial floor fma fmod frexp fsum gamma gcd hypot inf isclose isfinite isinf isnan isqrt lcm
    ldexp lgamma log log10 log1p log2 modf nan nextafter perm pi pow prod radians remainder sin sinh sqrt
    sumprod tan tanh tau trunc ulp
  `),
  ),
  random: new Set(
    words(`
    Random SystemRandom betavariate binomialvariate choice choices expovariate gammavariate gauss getrandbits
    getstate lognormvariate normalvariate paretovariate randbytes randint random randrange sample seed
    setstate shuffle triangular uniform vonmisesvariate weibullvariate
  `),
  ),
  statistics: new Set(
    words(`
    NormalDist StatisticsError correlation covariance fmean geometric_mean harmonic_mean kde kde_random
    linear_regression mean median median_grouped median_high median_low mode multimode pstdev pvariance
    quantiles stdev variance
  `),
  ),
  time: new Set(
    words(`
    altzone asctime clock_getres clock_gettime clock_gettime_ns clock_settime clock_settime_ns ctime daylight
    get_clock_info gmtime localtime mktime monotonic monotonic_ns perf_counter perf_counter_ns process_time
    process_time_ns sleep strftime strptime struct_time thread_time thread_time_ns time time_ns timezone tzname
    tzset CLOCK_BOOTTIME CLOCK_MONOTONIC CLOCK_MONOTONIC_RAW CLOCK_PROCESS_CPUTIME_ID CLOCK_REALTIME
    CLOCK_THREAD_CPUTIME_ID
  `),
  ),
  turtle: new Set(
    words(`
    ScrolledCanvas TurtleScreen Screen RawTurtle Turtle RawPen Pen Shape Vec2D Terminator
    addshape bgcolor bgpic bye clearscreen colormode delay exitonclick getcanvas getshapes listen mainloop
    mode numinput onclick onkey onkeypress onkeyrelease onscreenclick ontimer register_shape resetscreen
    screensize setup setworldcoordinates textinput title tracer turtles update window_height window_width
    back backward begin_fill begin_poly bk circle clear clearstamp clearstamps clone color degrees distance
    dot down end_fill end_poly fd fillcolor filling forward get_poly getpen getscreen get_shapepoly getturtle
    goto heading hideturtle home ht isdown isvisible left lt ondrag onrelease pd pen pencolor pendown pensize
    penup pos position pu radians right reset resizemode rt seth setheading setpos setposition settiltangle
    setundobuffer setx sety shape shapesize shapetransform shearfactor showturtle speed st stamp teleport tilt
    tiltangle towards turtlesize undo undobufferentries up width write xcor ycor done write_docstringdict
  `),
  ),
};

/**
 * An undefined name that's probably a missing import: name → the line to add.
 * (`from turtle import *` style imports are handled by `pythonModules`.)
 */
export const pythonImportHints: Record<string, string> = {
  ...Object.fromEntries(
    words(`
    math random time os sys json re datetime turtle statistics csv string collections itertools functools copy
    pathlib tkinter sqlite3 subprocess shutil glob pickle threading asyncio socket typing decimal fractions
    calendar webbrowser winsound platform uuid hashlib base64 unittest pprint textwrap heapq bisect operator
    dataclasses enum logging argparse secrets timeit cmath numpy pandas matplotlib requests pygame
  `).map((m) => [m, `import ${m}`]),
  ),
  np: 'import numpy as np',
  pd: 'import pandas as pd',
  plt: 'import matplotlib.pyplot as plt',
  tk: 'import tkinter as tk',
  sqrt: 'from math import sqrt',
  pi: 'from math import pi',
  sin: 'from math import sin',
  cos: 'from math import cos',
  tan: 'from math import tan',
  floor: 'from math import floor',
  ceil: 'from math import ceil',
  randint: 'from random import randint',
  choice: 'from random import choice',
  shuffle: 'from random import shuffle',
  uniform: 'from random import uniform',
  sleep: 'from time import sleep',
  mean: 'from statistics import mean',
  median: 'from statistics import median',
  dataclass: 'from dataclasses import dataclass',
  defaultdict: 'from collections import defaultdict',
  Counter: 'from collections import Counter',
  deque: 'from collections import deque',
  namedtuple: 'from collections import namedtuple',
  Path: 'from pathlib import Path',
  Fraction: 'from fractions import Fraction',
  Decimal: 'from decimal import Decimal',
  Enum: 'from enum import Enum',
  reduce: 'from functools import reduce',
  Optional: 'from typing import Optional',
  Any: 'from typing import Any',
};

/** Words from other languages: what Python uses instead. */
export const pythonLookalikes: Record<string, { use: string; note: string; replace?: boolean }> = {
  true: { use: 'True', note: 'Python skriver True med stor T.', replace: true },
  false: { use: 'False', note: 'Python skriver False med stor F.', replace: true },
  none: { use: 'None', note: 'Python skriver None med stor N.', replace: true },
  null: { use: 'None', note: 'Python bruker None for «ingenting».', replace: true },
  nil: { use: 'None', note: 'Python bruker None for «ingenting».', replace: true },
  NULL: { use: 'None', note: 'Python bruker None for «ingenting».', replace: true },
  this: { use: 'self', note: 'Python bruker self, ikke this.', replace: true },
  printf: { use: 'print', note: 'Python skriver ut med print(…).', replace: true },
  println: { use: 'print', note: 'Python skriver ut med print(…).', replace: true },
  echo: { use: 'print', note: 'Python skriver ut med print(…).', replace: true },
  console: { use: 'print', note: 'I Python skriver du ut med print(…), ikke console.log(…).' },
};

export const jsLookalikes: Record<string, { use: string; note: string; replace?: boolean }> = {
  True: { use: 'true', note: 'JavaScript skriver true med liten t.', replace: true },
  False: { use: 'false', note: 'JavaScript skriver false med liten f.', replace: true },
  None: { use: 'null', note: 'JavaScript bruker null for «ingenting».', replace: true },
  nil: { use: 'null', note: 'JavaScript bruker null for «ingenting».', replace: true },
  NULL: { use: 'null', note: 'JavaScript bruker null for «ingenting».', replace: true },
  print: { use: 'console.log', note: 'JavaScript skriver ut med console.log(…).', replace: true },
  println: { use: 'console.log', note: 'JavaScript skriver ut med console.log(…).', replace: true },
  len: { use: '.length', note: 'I JavaScript skriver du x.length, ikke len(x).' },
  self: { use: 'this', note: 'JavaScript bruker this, ikke self.' },
};

const jsGlobalList = words(`
  globalThis window self document navigator location history screen console alert confirm prompt fetch
  setTimeout clearTimeout setInterval clearInterval setImmediate clearImmediate requestAnimationFrame
  cancelAnimationFrame requestIdleCallback cancelIdleCallback queueMicrotask structuredClone atob btoa
  localStorage sessionStorage indexedDB crypto performance caches addEventListener removeEventListener
  dispatchEvent getComputedStyle matchMedia scrollTo scrollBy innerWidth innerHeight outerWidth outerHeight
  devicePixelRatio scrollX scrollY open close postMessage onmessage importScripts customElements
  visualViewport isSecureContext origin getSelection speechSynthesis reportError
  encodeURI encodeURIComponent decodeURI decodeURIComponent escape unescape eval isFinite isNaN parseFloat
  parseInt undefined arguments require module exports process global __dirname __filename Deno Bun
  Object Function Array Number Boolean String Symbol BigInt Math JSON Date RegExp Error TypeError RangeError
  SyntaxError ReferenceError EvalError URIError AggregateError Promise Proxy Reflect Map Set WeakMap WeakSet
  WeakRef FinalizationRegistry ArrayBuffer SharedArrayBuffer DataView Int8Array Uint8Array Uint8ClampedArray
  Int16Array Uint16Array Int32Array Uint32Array Float16Array Float32Array Float64Array BigInt64Array
  BigUint64Array Atomics Intl NaN Infinity Iterator URL URLSearchParams TextEncoder TextDecoder
  AbortController AbortSignal Blob File FileReader FormData Headers Request Response Event EventTarget
  CustomEvent Image Audio Option WebSocket Worker XMLHttpRequest MutationObserver ResizeObserver
  IntersectionObserver Buffer BroadcastChannel MessageChannel Notification DOMParser
  Node NodeList Element HTMLElement SVGElement Text DocumentFragment ShadowRoot Range Selection DOMRect
  HTMLInputElement HTMLTextAreaElement HTMLSelectElement HTMLButtonElement HTMLDivElement HTMLSpanElement
  HTMLAnchorElement HTMLImageElement HTMLCanvasElement HTMLAudioElement HTMLVideoElement CanvasRenderingContext2D
  KeyboardEvent MouseEvent PointerEvent InputEvent FocusEvent WheelEvent TouchEvent DragEvent
`);

let jsGlobalSet: Set<string> | null = null;

/** JavaScript globals: the list above, plus every capitalised global the runtime has (DOM classes). */
export function jsGlobals(): Set<string> {
  if (jsGlobalSet) return jsGlobalSet;
  jsGlobalSet = new Set(jsGlobalList);
  try {
    for (const name of Object.getOwnPropertyNames(globalThis)) if (/^[A-Z]/.test(name)) jsGlobalSet.add(name);
  } catch {
    // ignore
  }
  return jsGlobalSet;
}
