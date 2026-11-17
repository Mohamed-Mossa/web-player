import { describe, expect, it } from 'vitest';
import { XmltvParser, decodeEntities, nowNext, parseXmltv, parseXmltvTime, zonedParts } from '../src/xmltv';
import { XtreamClient } from '../src/xtream';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE tv SYSTEM "xmltv.dtd">
<tv generator-info-name="test">
  <channel id="mbc1.ae">
    <display-name lang="ar">إم بي سي 1</display-name>
    <display-name lang="en">MBC 1</display-name>
    <icon src="http://logo/mbc1.png" />
  </channel>
  <channel id="other"/>
  <programme start="20261117200000 +0200" stop="20261117213000 +0200" channel="mbc1.ae">
    <title lang="en">News &amp; Weather</title>
    <title lang="ar">الأخبار</title>
    <desc lang="ar"><![CDATA[نشرة <الأخبار> الرئيسية]]></desc>
    <category>News</category>
  </programme>
  <programme start="20261117213000 +0200" stop="20261117230000 +0200" channel="mbc1.ae"><title>Film &#8211; Night</title></programme>
  <programme start="20261117180000 +0000" stop="20261117190000 +0000" channel="other"><title>Skip me</title></programme>
</tv>`;

describe('XMLTV', () => {
  it('parses times with offsets', () => {
    expect(parseXmltvTime('20261117200000 +0200')).toBe(Date.UTC(2026, 10, 17, 18, 0, 0));
    expect(parseXmltvTime('20261117200000 -0530')).toBe(Date.UTC(2026, 10, 18, 1, 30, 0));
    expect(parseXmltvTime('202611172000')).toBe(Date.UTC(2026, 10, 17, 20, 0, 0));
  });

  it('decodes entities', () => {
    expect(decodeEntities('A &amp; B &#8211; &#x41;&lt;')).toBe('A & B – A<');
  });

  it('reads channels and programmes, preferring the UI language and filtering channels', () => {
    const r = parseXmltv(XML, { channels: new Set(['mbc1.ae']), langs: ['ar'] });
    expect(r.channels).toEqual([{ id: 'mbc1.ae', names: ['إم بي سي 1', 'MBC 1'], icon: 'http://logo/mbc1.png' }]);
    expect(r.programmes).toHaveLength(2);
    expect(r.programmes[0]).toMatchObject({ title: 'الأخبار', desc: 'نشرة <الأخبار> الرئيسية', category: 'News' });
    expect(r.programmes[1].title).toBe('Film – Night');
    expect(parseXmltv(XML, { langs: ['en'] }).programmes[0].title).toBe('News & Weather');
  });

  it('streams in tiny chunks with the same result', () => {
    const p = new XmltvParser();
    const progs = [];
    for (let i = 0; i < XML.length; i += 5) progs.push(...p.push(XML.slice(i, i + 5)).programmes);
    progs.push(...p.end().programmes);
    expect(progs.map((x) => x.title)).toEqual(parseXmltv(XML).programmes.map((x) => x.title));
  });

  it('drops programmes outside the time window', () => {
    const from = Date.UTC(2026, 10, 17, 19, 15);
    const r = parseXmltv(XML, { from, to: from + 3600_000 });
    expect(r.programmes.map((p) => p.channelId)).toEqual(['mbc1.ae', 'mbc1.ae']);
  });

  it('parses a 50 MB guide quickly', () => {
    const parts = ['<tv>'];
    for (let c = 0; c < 500; c++) {
      for (let h = 0; h < 200; h++) {
        parts.push(`<programme start="2026111${7 + Math.floor(h / 24) % 3}${String(h % 24).padStart(2, '0')}0000 +0000" stop="2026111700300 +0000" channel="c${c}"><title>Show ${h} on channel ${c}</title><desc>Some description text for the programme number ${h}.</desc></programme>`);
      }
    }
    parts.push('</tv>');
    const xml = parts.join('\n');
    const t0 = performance.now();
    const p = new XmltvParser({ channels: new Set(['c1', 'c2', 'c3']) });
    let n = 0;
    for (let i = 0; i < xml.length; i += 64 * 1024) n += p.push(xml.slice(i, i + 64 * 1024)).programmes.length;
    n += p.end().programmes.length;
    expect(n).toBe(600);
    expect(performance.now() - t0).toBeLessThan(4000);
  });

  it('finds now and next', () => {
    const { programmes } = parseXmltv(XML);
    const mbc = programmes.filter((p) => p.channelId === 'mbc1.ae');
    const r = nowNext(mbc, Date.UTC(2026, 10, 17, 19, 0));
    expect(r.now?.title).toBe('News & Weather');
    expect(r.next?.title).toBe('Film – Night');
    expect(nowNext(mbc, Date.UTC(2026, 10, 17, 10)).now).toBeUndefined();
  });

  it('builds catch-up URLs in the server time zone', () => {
    expect(zonedParts(Date.UTC(2026, 10, 17, 18, 5), 'Africa/Cairo')).toEqual({ y: '2026', mo: '11', d: '17', h: '20', mi: '05' });
    const c = new XtreamClient({ server: 'http://h', username: 'u', password: 'p' }, async () => ({}));
    expect(c.catchupUrl('7', Date.UTC(2026, 10, 17, 18, 5), 90, 'Africa/Cairo')).toBe('http://h/timeshift/u/p/90/2026-11-17:20-05/7.ts');
  });
});
