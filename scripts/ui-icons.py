# Original line icons for web/style.css (CSS masks). Run: python3 scripts/ui-icons.py > icons.css and replace the icon block at the end of web/style.css.
from urllib.parse import quote
S='fill="none" stroke="#000" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"'
F='fill="#000"'
I={
'page':f'<path {S} d="M4 1.75h5.25L12.5 5v9.25H4z"/><path {S} d="M9 1.75V5.25h3.5"/>',
'source':f'<rect {S} x="2" y="2.75" width="12" height="10.5" rx="1.5"/><path {S} d="M2 6.25h12M6.25 6.25v7"/>',
'view-table':f'<rect {S} x="2" y="2.75" width="12" height="10.5" rx="1.5"/><path {S} d="M2 6.5h12M6 6.5v6.75M10 6.5v6.75"/>',
'view-board':f'<rect {S} x="2" y="2.5" width="3.2" height="11" rx="1"/><rect {S} x="6.4" y="2.5" width="3.2" height="7" rx="1"/><rect {S} x="10.8" y="2.5" width="3.2" height="9" rx="1"/>',
'view-gallery':f'<rect {S} x="2" y="2" width="5" height="5" rx="1"/><rect {S} x="9" y="2" width="5" height="5" rx="1"/><rect {S} x="2" y="9" width="5" height="5" rx="1"/><rect {S} x="9" y="9" width="5" height="5" rx="1"/>',
'view-list':f'<path {S} d="M6 4h8M6 8h8M6 12h8"/><circle {F} cx="2.75" cy="4" r="1"/><circle {F} cx="2.75" cy="8" r="1"/><circle {F} cx="2.75" cy="12" r="1"/>',
'view-calendar':f'<rect {S} x="2" y="3" width="12" height="11" rx="1.5"/><path {S} d="M2 6.5h12M5.5 1.75v2.5M10.5 1.75v2.5"/>',
'view-timeline':f'<path {S} d="M2.5 4h6M5 8h8.5M3.5 12h6"/>',
'view-chart':f'<path {S} d="M2.5 13.5h11M4.5 11V8M8 11V4M11.5 11V6.5"/>',
'view-map':f'<path {S} d="M8 14s4.5-4.2 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 9.8 8 14 8 14z"/><circle {S} cx="8" cy="6.5" r="1.6"/>',
'view-form':f'<rect {S} x="2.5" y="2" width="11" height="12" rx="1.5"/><path {S} d="M5 5.5h6M5 8.5h6M5 11.5h3.5"/>',
'view-feed':f'<rect {S} x="2.5" y="2" width="11" height="5" rx="1.2"/><rect {S} x="2.5" y="9" width="11" height="5" rx="1.2"/>',
'view-dashboard':f'<rect {S} x="2" y="2" width="5.5" height="7" rx="1"/><rect {S} x="9" y="2" width="5" height="4" rx="1"/><rect {S} x="9" y="7.5" width="5" height="6.5" rx="1"/><rect {S} x="2" y="10.5" width="5.5" height="3.5" rx="1"/>',
'search':f'<circle {S} cx="7" cy="7" r="4.5"/><path {S} d="m10.5 10.5 3 3"/>',
'home':f'<path {S} d="M2.5 7.2 8 2.5l5.5 4.7V13.5H9.8v-3.6H6.2v3.6H2.5z"/>',
'switch':f'<path {S} d="M3 5.5h9.5L10 3M13 10.5H3.5L6 13"/>',
'inbox':f'<path {S} d="M2.5 9.5 4.3 3h7.4l1.8 6.5v4H2.5z"/><path {S} d="M2.5 9.5h3.2l.8 1.6h3l.8-1.6h3.2"/>',
'compose':f'<path {S} d="M7.5 2.5H3.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-4"/><path {S} d="M12.2 2.3a1.2 1.2 0 0 1 1.7 1.7L8.3 9.6 6 10l.4-2.3z"/>',
'import':f'<path {S} d="M8 2.5v7.5M5 7l3 3 3-3M2.5 11v2.5h11V11"/>',
'export':f'<path {S} d="M8 10V2.5M5 5.5l3-3 3 3M2.5 11v2.5h11V11"/>',
'send':f'<path {S} d="M14 2 7 9M14 2l-4.5 12L7 9 2 6.5z"/>',
'bell':f'<path {S} d="M4 11.5V7a4 4 0 0 1 8 0v4.5l1 1H3z"/><path {S} d="M6.6 14h2.8"/>',
'clock':f'<circle {S} cx="8" cy="8" r="5.75"/><path {S} d="M8 5v3.2l2 1.3"/>',
'backup':f'<ellipse {S} cx="8" cy="4" rx="5" ry="1.8"/><path {S} d="M3 4v8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8V4M3 8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8"/>',
'trash':f'<path {S} d="M2.75 4.25h10.5M6.25 4.25V2.75h3.5v1.5M4 4.25l.7 9h6.6l.7-9"/>',
'refresh':f'<path {S} d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v2.8h-2.8"/>',
'undo':f'<path {S} d="M5 3 2.5 5.5 5 8"/><path {S} d="M2.5 5.5h7a3.5 3.5 0 0 1 0 7H6"/>',
'redo':f'<path {S} d="M11 3l2.5 2.5L11 8"/><path {S} d="M13.5 5.5h-7a3.5 3.5 0 0 0 0 7H10"/>',
'history':f'<path {S} d="M2.5 8a5.5 5.5 0 1 0 1.7-4"/><path {S} d="M2.3 2.5v2.8h2.8M8 5v3.2l2 1.3"/>',
'agent':f'<path {S} d="M8 2v2.5M8 11.5V14M2 8h2.5M11.5 8H14M8 5.2 9 7l1.8 1L9 9l-1 1.8L7 9 5.2 8 7 7z"/>',
'star':f'<path {S} d="m8 2 1.8 3.8 4.1.5-3 2.9.8 4.1L8 11.3l-3.7 2 .8-4.1-3-2.9 4.1-.5z"/>',
'star-filled':f'<path {F} d="m8 2 1.8 3.8 4.1.5-3 2.9.8 4.1L8 11.3l-3.7 2 .8-4.1-3-2.9 4.1-.5z"/>',
'more':f'<circle {F} cx="3.5" cy="8" r="1.3"/><circle {F} cx="8" cy="8" r="1.3"/><circle {F} cx="12.5" cy="8" r="1.3"/>',
'sidebar':f'<rect {S} x="2" y="2.75" width="12" height="10.5" rx="1.75"/><path {S} d="M6.25 2.75v10.5"/>',
'color':f'<rect {S} x="2.25" y="2" width="9.5" height="3.75" rx="1"/><path {S} d="M11.75 3.9h1.5v3.35H7.75v2"/><rect {S} x="6.5" y="9.25" width="2.5" height="4.75" rx=".8"/>',
'pin':f'<path {S} d="M6 2.5h4M7 2.5v4L4.5 9h7L9 6.5v-4M8 9v4.5"/>',
'chevron-right':f'<path {S} d="m6.5 4 4 4-4 4"/>',
'chevron-down':f'<path {S} d="m4 6.5 4 4 4-4"/>',
'chevron-left':f'<path {S} d="m9.5 4-4 4 4 4"/>',
'plus':f'<path {S} d="M8 3v10M3 8h10"/>',
'drag':f'<circle {F} cx="5.75" cy="3.5" r="1.15"/><circle {F} cx="10.25" cy="3.5" r="1.15"/><circle {F} cx="5.75" cy="8" r="1.15"/><circle {F} cx="10.25" cy="8" r="1.15"/><circle {F} cx="5.75" cy="12.5" r="1.15"/><circle {F} cx="10.25" cy="12.5" r="1.15"/>',
'filter':f'<path {S} d="M2.5 4.5h11M4.5 8h7M6.5 11.5h3"/>',
'sort':f'<path {S} d="M5 13V3M2.75 5.25 5 3l2.25 2.25M11 3v10M8.75 10.75 11 13l2.25-2.25"/>',
'settings':f'<path {S} d="M2.5 5h6M11.5 5h2M2.5 11h2M7.5 11h6"/><circle {S} cx="10" cy="5" r="1.5"/><circle {S} cx="6" cy="11" r="1.5"/>',
'close':f'<path {S} d="m4 4 8 8M12 4l-8 8"/>',
'expand':f'<path {S} d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9"/>',
'peek-close':f'<path {S} d="m4 4 4 4-4 4M8.5 4l4 4-4 4"/>',
'emoji':f'<circle {S} cx="8" cy="8" r="5.75"/><path {S} d="M5.6 9.6a3 3 0 0 0 4.8 0"/><circle {F} cx="6" cy="6.6" r=".9"/><circle {F} cx="10" cy="6.6" r=".9"/>',
'image':f'<rect {S} x="2" y="3" width="12" height="10" rx="1.5"/><path {S} d="m2.5 11.5 3.3-3.3 2.7 2.7 1.8-1.8 3.2 3.2"/><circle {F} cx="10.5" cy="6" r="1.1"/>',
'comment':f'<path {S} d="M2.5 3.5h11v7.5H7l-3 2.5V11H2.5z"/>',
'appearance':f'<rect {S} x="2" y="2.5" width="12" height="11" rx="1.5"/><path {S} d="M2 6h12"/>',
'synced':f'<path {S} d="M3 6.5A5 5 0 0 1 12.2 4.6M13 2.5v2.6h-2.6M13 9.5a5 5 0 0 1-9.2 1.9M3 13.5v-2.6h2.6"/>',
'file':f'<path {S} d="M10.5 5.5 6.3 9.7a1.3 1.3 0 0 0 1.8 1.8l4.6-4.6a2.6 2.6 0 0 0-3.7-3.7L4.4 7.8a3.9 3.9 0 0 0 5.5 5.5l3.1-3.1"/>',
'duplicate':f'<rect {S} x="5.5" y="5.5" width="8" height="8" rx="1.3"/><path {S} d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/>',
'move':f'<path {S} d="M2.5 8h9M8.5 5l3 3-3 3M13.5 3v10"/>',
'tasks':f'<path {S} d="m2.5 4 1.2 1.2L6 3M2.5 10l1.2 1.2L6 9M8 4.2h5.5M8 10.2h5.5"/>',
'repeat':f'<path {S} d="M3 7V6a2 2 0 0 1 2-2h8M11 2l2 2-2 2M13 9v1a2 2 0 0 1-2 2H3M5 14l-2-2 2-2"/>',
'template':f'<rect {S} x="2.5" y="2" width="11" height="12" rx="1.5"/><path {S} d="M5 5h6M5 8h3"/><path {S} d="M10.5 9.5v3M9 11h3"/>',
'turn-into':f'<path {S} d="M3 6h8.5L9 3.5M13 10H4.5L7 12.5"/>',
'arrow-up':f'<path {S} d="M8 13V3M4 7l4-4 4 4"/>',
'arrow-left':f'<path {S} d="M13 8H3M7 4 3 8l4 4"/>',
'eye-off':f'<path {S} d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4z"/><path {S} d="M3 13 13 3"/>',
'link':f'<path {S} d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2-2a2.6 2.6 0 1 0-3.7-3.7l-.6.6M9.2 6.8a2.6 2.6 0 0 0-3.7 0l-2 2a2.6 2.6 0 1 0 3.7 3.7l.6-.6"/>',
'mention':f'<circle {S} cx="8" cy="8" r="2.4"/><path {S} d="M10.4 8v1a1.8 1.8 0 0 0 3.6 0V8a6 6 0 1 0-2.4 4.8"/>',
'unlink':f'<path {S} d="M9.3 5.2l.6-.6a2.6 2.6 0 1 1 3.7 3.7l-1 1M6.7 10.8l-.6.6a2.6 2.6 0 1 1-3.7-3.7l1-1M2.5 2.5l11 11"/>',
'clear-format':f'<path {S} d="M3.5 3.5h8M7.5 3.5 5.5 13M9.5 9.5l4 4M13.5 9.5l-4 4"/>',
'resize':f'<path {S} d="M2.5 8h11M5 5.5 2.5 8 5 10.5M11 5.5 13.5 8 11 10.5"/>',
'dependency':f'<path {S} d="M3 3.5h4v9h5.5M10 10l2.5 2.5L10 15"/>',
'type-title':f'<path {S} d="M2 12.5 5.2 4h.6l3.2 8.5M3.2 9.5h4.6"/><path {S} d="M13.5 12.5V9.3a1.8 1.8 0 0 0-3.4-.8M13.5 10.6c-2.2-.4-3.5.2-3.5 1.1s1.2 1.3 3.5.2"/>',
'type-text':f'<path {S} d="M2.5 4h11M2.5 8h11M2.5 12h7"/>',
'type-number':f'<path {S} d="M6 2.5 4.5 13.5M11.5 2.5 10 13.5M2.5 5.8h11M2 10.2h11"/>',
'type-select':f'<circle {S} cx="8" cy="8" r="5.75"/><path {S} d="m5.5 7 2.5 2.5L10.5 7"/>',
'type-multi_select':f'<path {S} d="M6 4h8M6 8h8M6 12h8"/><path {S} d="m1.8 4 .8.8L4 3.3M1.8 8l.8.8L4 7.3M1.8 12l.8.8L4 11.3"/>',
'type-status':f'<path {S} d="M8 2.25a5.75 5.75 0 1 1-5.4 3.8" stroke-dasharray="2 1.6"/><path {F} d="M8 4.8a3.2 3.2 0 1 1 0 6.4z"/>',
'type-date':f'<rect {S} x="2" y="3" width="12" height="11" rx="1.5"/><path {S} d="M2 6.5h12M5.5 1.75v2.5M10.5 1.75v2.5"/>',
'type-person':f'<circle {S} cx="8" cy="5.5" r="2.75"/><path {S} d="M2.75 14a5.25 5.25 0 0 1 10.5 0"/>',
'type-files':f'<path {S} d="M10.5 5.5 6.3 9.7a1.3 1.3 0 0 0 1.8 1.8l4.6-4.6a2.6 2.6 0 0 0-3.7-3.7L4.4 7.8a3.9 3.9 0 0 0 5.5 5.5l3.1-3.1"/>',
'type-checkbox':f'<rect {S} x="2.5" y="2.5" width="11" height="11" rx="2"/><path {S} d="m5.2 8.2 2 2 3.8-4.2"/>',
'type-url':f'<path {S} d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2-2a2.6 2.6 0 1 0-3.7-3.7l-.6.6M9.2 6.8a2.6 2.6 0 0 0-3.7 0l-2 2a2.6 2.6 0 1 0 3.7 3.7l.6-.6"/>',
'type-email':f'<circle {S} cx="8" cy="8" r="2.4"/><path {S} d="M10.4 8v1a1.8 1.8 0 0 0 3.6 0V8a6 6 0 1 0-2.4 4.8"/>',
'type-phone':f'<path {S} d="M3.5 2.5h2.2l1 3-1.5 1a8 8 0 0 0 4.3 4.3l1-1.5 3 1v2.2a1 1 0 0 1-1 1A10.5 10.5 0 0 1 2.5 3.5a1 1 0 0 1 1-1z"/>',
'type-formula':f'<path {S} d="M12 3H4l4.2 5L4 13h8"/>',
'type-relation':f'<path {S} d="M5 11 11 5M6 5h5v5"/><rect {S} x="2" y="2" width="12" height="12" rx="2"/>',
'type-rollup':f'<circle {S} cx="7" cy="7" r="4.5"/><path {S} d="m10.5 10.5 3 3M5 7h4M7 5v4"/>',
'type-created_time':f'<circle {S} cx="8" cy="8" r="5.75"/><path {S} d="M8 5v3.2l2 1.3"/>',
'type-last_edited_time':f'<circle {S} cx="8" cy="8" r="5.75"/><path {S} d="M8 5v3.2l2 1.3"/>',
'type-created_by':f'<circle {S} cx="8" cy="5.5" r="2.75"/><path {S} d="M2.75 14a5.25 5.25 0 0 1 10.5 0"/>',
'type-last_edited_by':f'<circle {S} cx="8" cy="5.5" r="2.75"/><path {S} d="M2.75 14a5.25 5.25 0 0 1 10.5 0"/>',
'type-unique_id':f'<path {S} d="M3.5 3v10M7 3h2.5a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3H7z"/>',
'type-place':f'<path {S} d="M8 14s4.5-4.2 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 9.8 8 14 8 14z"/><circle {S} cx="8" cy="6.5" r="1.6"/>',
'type-button':f'<path {S} d="m6 6 7 2.6-3 1.2-1.2 3z"/><path {S} d="M4.5 2.5v1.8M2.5 4.5h1.8M3.2 3.2l1.2 1.2"/>',
}
out=[]
for name,body in I.items():
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">{body}</svg>'
    out.append(f'.icon-{name}{{--i:url("data:image/svg+xml,{quote(svg,safe="")}")}}')
print('\n'.join(out))

# mask variables reused by pseudo-elements
I['caret']=f'<path {F} d="M5.5 3.5 11 8l-5.5 4.5z"/>'
I['check']='<path fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m3.5 8.5 3 3 6-7"/>'
names=['page','source','caret','check']+[k for k in I if k.startswith('view-')]
vars_=[]
for name in names:
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">{I[name]}</svg>'
    vars_.append(f'--icon-{name}-mask:url("data:image/svg+xml,{quote(svg,safe="")}");')
print(':root{'+''.join(vars_)+'}')
print('[data-kind=source]{--kind-icon:var(--icon-source-mask)}[data-kind=view]{--kind-icon:var(--icon-view-table-mask)}')
for v in ['table','board','gallery','list','calendar','timeline','chart','map','form','feed','dashboard']:
    print(f'[data-view-type={v}]{{--kind-icon:var(--icon-view-{v}-mask)}}')
