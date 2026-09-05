import { describe, expect, it } from 'vitest'
import {
  envelopeToText,
  mapDuckDuckGoResults,
  resolveModsearchCliEntry,
} from '../run'

describe('resolveModsearchCliEntry', () => {
  it('points at modsearch dist/main.js', () => {
    const entry = resolveModsearchCliEntry()
    expect(entry.replace(/\\/g, '/')).toMatch(/modsearch[/\\]dist[/\\]main\.js$/)
  })
})

describe('mapDuckDuckGoResults', () => {
  it('maps scrape hits into ModSearch-shaped envelope', () => {
    const env = mapDuckDuckGoResults(
      'hello',
      [
        { title: 'A', url: 'https://a.example', description: 'alpha' },
        { title: 'B', url: 'https://b.example', description: 'beta' },
      ],
      2,
      'modsearch timeout',
    )
    expect(env.mode).toBe('search')
    expect(env.fallback).toEqual({
      used: true,
      engine: 'duckduckgo',
      reason: 'modsearch timeout',
    })
    expect(env.results[0]?.engine).toBe('duckduckgo')
    expect(env.results[0]?.items).toHaveLength(2)
    expect(env.results[0]?.items?.[0]?.url).toBe('https://a.example')
  })

  it('throws when empty', () => {
    expect(() => mapDuckDuckGoResults('q', [])).toThrow(/无结果/)
  })
})

describe('envelopeToText', () => {
  it('serializes json', () => {
    const text = envelopeToText({
      mode: 'search',
      query: 'q',
      results: [],
    })
    expect(JSON.parse(text).query).toBe('q')
  })
})
