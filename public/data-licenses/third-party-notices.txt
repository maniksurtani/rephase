# Third-party notices

## Forger99 circadian model reference

Rephase's `src/lib/circadian/index.ts` ports the Forger99 right-hand side and
parameter defaults in Arcascope's `circadian/models.py`, version 1.0.3, commit
`db6eb08b6c0b0586cdac7795bf10bbbbfd323c1a`:
https://github.com/Arcascope/circadian/blob/db6eb08b6c0b0586cdac7795bf10bbbbfd323c1a/circadian/models.py

Original publication: Forger DB, Jewett ME, Kronauer RE. A simpler model of the
human circadian pacemaker. Journal of Biological Rhythms. 1999;14(6):532–537.
https://doi.org/10.1177/074873099129000867

The reference repository's LICENSE at that commit contains the MIT license
below (its packaging metadata separately says Apache; this port follows the
actual LICENSE file). Numerical verification compares this port with the
reference's Python derivatives using SciPy DOP853 and its RK4 implementation.
This is verification of equations and numerical implementation, **not clinical
validation of Rephase or a measurement of an individual's circadian phase**.

MIT License

Copyright (c) [2023] [Kevin Hannay]

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Bundled fonts

DM Sans and Manrope are distributed under the SIL Open Font License 1.1.
Copyright and full licenses are preserved in `public/fonts/dmsans-OFL.txt` and
`public/fonts/manrope-OFL.txt` respectively.

## Solar calculations

The sunrise/sunset formulas in `src/lib/daylight.ts` follow SunCalc
([source](https://github.com/mourner/suncalc)), distributed under the BSD
2-Clause License. Copyright (c) 2011–2015, Vladimir Agafonkin.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
