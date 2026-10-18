import { excerptRange } from '../learning';
import type { Segment } from '../types';

export function makeButton(label: string, action: () => void): HTMLButtonElement {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.addEventListener('click', action); return button;
}
function paragraph(className: string, text: string) { const p = document.createElement('p'); p.className = className; p.textContent = text; return p; }
export function renderSegment(segment: Segment): HTMLElement {
  const article = document.createElement('article'); article.className = 'segment';
  const source = paragraph('source', segment.source), translation = paragraph('translation', segment.translation);
  article.append(source, translation);
  const learning = segment.learning; if (!learning) return article;
  if (learning.chunks.length) {
    const heading = document.createElement('h4'); heading.textContent = 'Tách cụm'; article.append(heading);
    const list = document.createElement('dl'); list.className = 'chunks';
    for (const chunk of learning.chunks) {
      const dt = document.createElement('dt'), dd = document.createElement('dd'); dd.textContent = chunk.meaning;
      const button = makeButton(chunk.text, () => {
        source.textContent = segment.source;
        const range = excerptRange(segment.source, chunk.text); if (!range) return;
        const mark = document.createElement('mark'); mark.textContent = segment.source.slice(range.start, range.end);
        source.replaceChildren(document.createTextNode(segment.source.slice(0, range.start)), mark, document.createTextNode(segment.source.slice(range.end)));
        for (const b of list.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b === button));
      });
      button.className = 'chunk'; button.setAttribute('aria-pressed', 'false'); dt.append(button); list.append(dt, dd);
    }
    article.append(list);
  }
  if (learning.structures.length) {
    const details = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = 'Cấu trúc và ví dụ'; details.append(summary);
    for (const structure of learning.structures) {
      const block = document.createElement('section'); block.className = 'structure';
      const pattern = document.createElement('strong'); pattern.textContent = structure.pattern;
      block.append(pattern, paragraph('excerpt', structure.excerpt), paragraph('explanation', structure.explanation), paragraph('example', structure.example), paragraph('example-translation', structure.exampleTranslation)); details.append(block);
    }
    article.append(details);
  }
  for (const note of learning.notes) article.append(paragraph('note', note));
  return article;
}
