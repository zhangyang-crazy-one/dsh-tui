/**
 * OSC 8 capability detection, wrapping, and the plain-text fallback.
 */

import { afterEach, describe, expect, it } from 'vitest'
import {
  detectHyperlinks,
  hyperlinksEnabled,
  installHyperlinks,
  isOsc8Href,
  linkNeedsUrlSuffix,
  probeTmuxHyperlinks,
  setHyperlinks,
  wrapLink,
  wrapOsc8,
} from '../src/hyperlink.ts'

afterEach(() => {
  setHyperlinks(false)
})

describe('detectHyperlinks', () => {
  it('defaults unknown terminals off', () => {
    expect(detectHyperlinks({})).toBe(false)
    expect(detectHyperlinks({ TERM: 'xterm' })).toBe(false)
  })

  it('turns screen and unprobed tmux off', () => {
    expect(detectHyperlinks({ TERM: 'screen-256color' })).toBe(false)
    expect(detectHyperlinks({ TMUX: '1' })).toBe(false)
    expect(detectHyperlinks({ TMUX: '1' }, () => false)).toBe(false)
    expect(detectHyperlinks({ TERM: 'tmux-256color' }, () => false)).toBe(false)
  })

  it('honours a tmux probe that reports forwarding', () => {
    expect(detectHyperlinks({ TMUX: '1' }, () => true)).toBe(true)
  })

  it('recognizes known hyperlink-capable terminals', () => {
    expect(detectHyperlinks({ KITTY_WINDOW_ID: '1' })).toBe(true)
    expect(detectHyperlinks({ TERM_PROGRAM: 'kitty' })).toBe(true)
    expect(detectHyperlinks({ TERM_PROGRAM: 'ghostty' })).toBe(true)
    expect(detectHyperlinks({ TERM: 'xterm-ghostty' })).toBe(true)
    expect(detectHyperlinks({ GHOSTTY_RESOURCES_DIR: '/opt' })).toBe(true)
    expect(detectHyperlinks({ WEZTERM_PANE: '1' })).toBe(true)
    expect(detectHyperlinks({ TERM_PROGRAM: 'wezterm' })).toBe(true)
    expect(detectHyperlinks({ TERM_PROGRAM: 'warpterminal' })).toBe(true)
    expect(detectHyperlinks({ WARP_SESSION_ID: '1' })).toBe(true)
    expect(detectHyperlinks({ WARP_TERMINAL_SESSION_UUID: '1' })).toBe(true)
    expect(detectHyperlinks({ ITERM_SESSION_ID: 'w0t0p0' })).toBe(true)
    expect(detectHyperlinks({ TERM_PROGRAM: 'iTerm.app' })).toBe(true)
    expect(detectHyperlinks({ WT_SESSION: '1' })).toBe(true)
    expect(detectHyperlinks({ TERM_PROGRAM: 'vscode' })).toBe(true)
    expect(detectHyperlinks({ TERM_PROGRAM: 'alacritty' })).toBe(true)
  })

  it('keeps JetBrains terminal on the plain-text path', () => {
    expect(detectHyperlinks({ TERMINAL_EMULATOR: 'JetBrains-JediTerm' })).toBe(
      false,
    )
  })
})

describe('probeTmuxHyperlinks', () => {
  it('returns false when tmux is absent', () => {
    expect(probeTmuxHyperlinks()).toBe(false)
  })

  it('reads client_termfeatures from an injected exec', () => {
    expect(
      probeTmuxHyperlinks(() => '256color,hyperlinks,title'),
    ).toBe(true)
    expect(probeTmuxHyperlinks(() => '256color')).toBe(false)
  })

  it('returns false when the injected exec throws', () => {
    expect(
      probeTmuxHyperlinks(() => {
        throw new Error('tmux: no server')
      }),
    ).toBe(false)
  })
})

describe('installHyperlinks', () => {
  it('stores the detected flag', () => {
    expect(installHyperlinks({ TERM_PROGRAM: 'ghostty' })).toBe(true)
    expect(hyperlinksEnabled()).toBe(true)
    setHyperlinks(false)
    expect(hyperlinksEnabled()).toBe(false)
  })
})

describe('isOsc8Href', () => {
  it('accepts http(s), mailto, and file, and rejects the rest', () => {
    expect(isOsc8Href('https://example.com')).toBe(true)
    expect(isOsc8Href('http://example.com')).toBe(true)
    expect(isOsc8Href('mailto:a@b.com')).toBe(true)
    expect(isOsc8Href('file:///tmp/x')).toBe(true)
    expect(isOsc8Href('')).toBe(false)
    expect(isOsc8Href('javascript:alert(1)')).toBe(false)
    expect(isOsc8Href('https://ex.com/\x1b')).toBe(false)
    expect(isOsc8Href('./relative')).toBe(false)
  })
})

describe('wrapOsc8 / wrapLink', () => {
  it('wraps styled text in OSC 8', () => {
    expect(wrapOsc8('docs', 'https://example.com')).toBe(
      '\x1b]8;;https://example.com\x1b\\docs\x1b]8;;\x1b\\',
    )
  })

  it('prints (href) when OSC 8 is off and the label differs', () => {
    setHyperlinks(false)
    expect(linkNeedsUrlSuffix('docs', 'https://example.com')).toBe(true)
    expect(linkNeedsUrlSuffix('https://example.com', 'https://example.com')).toBe(
      false,
    )
    expect(linkNeedsUrlSuffix('a@b.com', 'mailto:a@b.com')).toBe(false)
    expect(
      wrapLink('docs', 'docs', 'https://example.com', ' (https://example.com)'),
    ).toEqual(['docs', ' (https://example.com)'])
    expect(
      wrapLink('https://example.com', 'https://example.com', 'https://example.com', ' (x)'),
    ).toEqual(['https://example.com'])
    expect(wrapLink('docs', 'docs', 'https://example.com', '')).toEqual(['docs'])
  })

  it('uses OSC 8 when installed and the href is safe', () => {
    setHyperlinks(true)
    expect(wrapLink('docs', 'docs', 'https://example.com', ' (x)')).toEqual([
      wrapOsc8('docs', 'https://example.com'),
    ])
    expect(wrapLink('docs', 'docs', './local', ' (./local)')).toEqual([
      'docs',
      ' (./local)',
    ])
    setHyperlinks(false)
  })
})
