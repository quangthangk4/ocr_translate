import '../../src/ui/shared.css';
import './style.css';
import { RecordStore } from '../../src/records';
import { searchHistory, type HistoryHit } from '../../src/history-search';
import { excerptRange } from '../../src/learning';
import { renderSegment } from '../../src/ui/study';
import { methodCatalog } from '../../src/methods/catalog';

const store = new RecordStore();
const query = document.querySelector<HTMLInputElement>('#query')!;
const results = document.querySelector<HTMLElement>('#results')!;
const status = document.querySelector<HTMLElement>('#status')!;
const pagination = document.querySelector<HTMLElement>('#pagination')!;
const previous = document.querySelector<HTMLButtonElement>('#previous')!;
const next = document.querySelector<HTMLButtonElement>('#next')!;
let controller: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined, offset = 0, total = 0;
const limit = 20;

function highlight(element: HTMLElement, needle: string) {
  if (!needle.trim()) return;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const text = node.textContent ?? '', fragment = document.createDocumentFragment(); let position = 0;
    const phraseMatch = !!excerptRange(text, needle);
    while (position < text.length) {
      const rest = text.slice(position);
      let range = excerptRange(rest, needle);
      if (!range && !phraseMatch) range = needle.trim().split(/\s+/u).filter(word => word.length > 1 || needle.trim().length === 1).map(word => excerptRange(rest, word)).filter((r): r is { start: number; end: number } => !!r).sort((a, b) => a.start - b.start || b.end - a.end)[0];
      if (!range) { fragment.append(document.createTextNode(rest)); break; }
      fragment.append(document.createTextNode(rest.slice(0, range.start)));
      const mark = document.createElement('mark'); mark.textContent = rest.slice(range.start, range.end); fragment.append(mark);
      position += range.end;
    }
    node.replaceWith(fragment);
  }
}
function renderHit(hit: HistoryHit, needle: string) {
  const card = document.createElement('article'); card.className = 'card history-result'; card.dataset.recordId = hit.recordId;
  const header = document.createElement('div'); header.className = 'result-meta';
  const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = hit.segment.learning ? 'Có giải thích' : hit.methodId.includes('ocr') ? 'Văn bản OCR' : 'Dịch nhanh';
  const time = document.createElement('time'); time.dateTime = new Date(hit.createdAt).toISOString(); time.textContent = new Date(hit.createdAt).toLocaleDateString('vi-VN');
  header.append(badge, time); card.append(header);
  const content = renderSegment(hit.segment);
  if (hit.segment.learning) {
    const details = document.createElement('details'); details.className = 'saved-learning';
    const summary = document.createElement('summary'); summary.textContent = 'Xem giải thích đã lưu'; details.append(summary);
    for (const child of [...content.children]) if (!child.matches('.source,.translation')) details.append(child);
    content.append(details);
  } else {
    const note = document.createElement('p'); note.className = 'muted no-learning'; note.textContent = 'Mục này chưa có phần giải thích đã lưu.'; content.append(note);
  }
  if (!hit.segment.translation) content.querySelector('.translation')?.remove();
  highlight(content, needle); card.append(content);
  if (hit.matchedText) {
    const match = document.createElement('p'); match.className = 'match-context';
    const range = excerptRange(hit.matchedText, needle), start = Math.max(0, (range?.start ?? 0) - 90);
    match.textContent = `Khớp trong nội dung: ${start ? '…' : ''}${hit.matchedText.slice(start, start + 350)}${hit.matchedText.length > start + 350 ? '…' : ''}`;
    highlight(match, needle); card.append(match);
  }
  const footer = document.createElement('footer');
  const method = document.createElement('span'); method.className = 'muted'; method.textContent = hit.model || methodCatalog.find(m => m.id === hit.methodId)?.label || hit.methodId;
  footer.append(method);
  try {
    const url = new URL(hit.pageUrl);
    if (/^https?:$/.test(url.protocol)) { const link = document.createElement('a'); link.href = url.href; link.target = '_blank'; link.rel = 'noreferrer'; link.textContent = 'Mở trang gốc'; link.title = url.href; footer.append(link); }
  } catch { /* Do not create unsafe links from old or malformed records. */ }
  card.append(footer); return card;
}
async function search() {
  clearTimeout(timer); controller?.abort(); const current = new AbortController(); controller = current;
  const needle = query.value.trim();
  results.replaceChildren(); results.setAttribute('aria-busy', 'true'); pagination.hidden = true;
  status.classList.remove('error'); status.textContent = 'Đang tìm trong dữ liệu đã lưu trên máy…';
  const params = new URLSearchParams(); if (needle) params.set('q', needle);
  history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}`);
  try {
    const [found, stats] = await Promise.all([searchHistory(store.entries(current.signal), needle, offset, limit, current.signal), store.stats()]);
    if (current.signal.aborted) return;
    // A concurrent delete may shrink the last page; search the preceding page instead.
    if (offset && offset >= found.total) { offset = Math.max(0, Math.ceil(found.total / limit) * limit - limit); void search(); return; }
    total = found.total;
    results.append(...found.hits.map(hit => renderHit(hit, needle)));
    document.querySelector('#storage-info')!.textContent = `${stats.count} thẻ đã lưu · Khoảng ${(stats.bytes / 1024 / 1024).toFixed(2)} MB · Không tự xóa mục cũ`;
    status.textContent = !stats.count ? 'Chưa có lịch sử. Các lần dịch và OCR tiếp theo sẽ được lưu ở đây.' : !total ? 'Không tìm thấy kết quả. Thử cụm ngắn hơn hoặc từ khác.' : needle ? `Tìm thấy ${total} câu phù hợp · Đang hiện ${offset + 1}–${Math.min(offset + limit, total)}.` : `Các câu đã lưu gần đây · Đang hiện ${offset + 1}–${Math.min(offset + limit, total)} trong ${total} câu.`;
    previous.disabled = offset === 0; next.disabled = offset + limit >= total;
    document.querySelector('#page-number')!.textContent = `Trang ${Math.floor(offset / limit) + 1} / ${Math.max(1, Math.ceil(total / limit))}`;
    pagination.hidden = total <= limit;
  } catch (error) { if (!current.signal.aborted) { status.classList.add('error'); status.textContent = (error as Error)?.message ?? 'Không đọc được lịch sử. Hãy tải lại trang.'; } }
  finally { if (!current.signal.aborted) results.setAttribute('aria-busy', 'false'); }
}
query.value = new URLSearchParams(location.search).get('q')?.slice(0, 200) ?? '';
document.querySelector('#search-form')!.addEventListener('submit', event => { event.preventDefault(); offset = 0; void search(); });
query.addEventListener('input', () => { controller?.abort(); clearTimeout(timer); offset = 0; timer = setTimeout(() => { void search(); }, 250); });
previous.addEventListener('click', () => { offset = Math.max(0, offset - limit); void search(); });
next.addEventListener('click', () => { if (offset + limit < total) { offset += limit; void search(); } });
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && (changes.recordIndexV2 || Object.keys(changes).some(key => key.startsWith('translationV2:')))) { controller?.abort(); clearTimeout(timer); timer = setTimeout(() => { void search(); }, 100); } });
window.addEventListener('pagehide', () => { controller?.abort(); clearTimeout(timer); });
void search();
