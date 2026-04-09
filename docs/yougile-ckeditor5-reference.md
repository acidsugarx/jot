# Yougile CKEditor 5 HTML Reference

Scraped from Yougile web UI (answer42.yougile.com) on 2026-04-09.

## Key Discovery: Live DOM ≠ Saved API

CKEditor 5 transforms HTML between editing and persistence.

### Checkbox (live DOM — what CKEditor renders)
```html
<ul class="todo-list">
  <li data-list-item-id="...">
    <span class="todo-list__label todo-list__label_without-description">
      <span contenteditable="false">
        <input type="checkbox" tabindex="-1">
      </span>
    </span>
    <p>text</p>
  </li>
</ul>
```

### Checkbox (saved API — what gets stored)
```html
<ul class="todo-list">
  <li>
    <label class="todo-list__label todo-list__label_without-description">
      <input type="checkbox" disabled="disabled">
    </label>
    <p>text</p>
  </li>
</ul>
```

### Differences

| Aspect | Live DOM | Saved API |
|--------|----------|-----------|
| Checkbox wrapper | `<span>` | `<label>` |
| contenteditable guard | `<span contenteditable="false">` | (none) |
| Input attrs | `tabindex="-1"` | `disabled="disabled"` |
| data-list-item-id | Present | Stripped |
| Empty paragraph | `<p><br data-cke-filler="true"></p>` | `<p> </p>` |
| List items | `<li><p>text</p></li>` | Same |

## All Block Types

### Paragraphs
```html
<p>plain text</p>
<p><br data-cke-filler="true"></p>  <!-- empty (live) -->
<p> </p>                            <!-- empty (saved) -->
```

### Headings
```html
<h2>text</h2>
<h3>text</h3>
<h4>text</h4>
```

### Text Formatting
```html
<p><strong>bold</strong></p>
<p><i>italic</i></p>
<p><i><s>italic+strikethrough</s></i></p>
<p><s><u>strikethrough+underline</u></s></p>
<p><u>underline</u></p>
```

### Text Alignment
```html
<p style="text-align:right;">text</p>
<p style="text-align:center;">text</p>
<p style="text-align:justify;">text</p>
```

### Inline Colors (Yougile extension)
```html
<span style="background-color:#A9D4D4;color:#6BC125;">text</span>
```

### Bullet List (nested, with todo-list child)
```html
<ul>
  <li data-list-item-id="...">
    <p style="text-align:justify;">dsa</p>
    <ul>
      <li data-list-item-id="...">
        <p style="text-align:justify;">dsadas</p>
        <ul class="todo-list">
          <li data-list-item-id="...">
            <span class="todo-list__label todo-list__label_without-description">
              <span contenteditable="false">
                <input type="checkbox" tabindex="-1">
              </span>
            </span>
            <p style="text-align:justify;">dasdas</p>
            <ul>
              <li data-list-item-id="...">
                <p style="text-align:justify;">dsadas</p>
              </li>
            </ul>
          </li>
        </ul>
      </li>
    </ul>
  </li>
</ul>
```

### Numbered List (with marker color)
```html
<ol>
  <li class="ck-list-marker-color" style="--ck-content-list-marker-color:#6BC125;" data-list-item-id="...">
    <p style="text-align:justify;"><span style="background-color:#A9D4D4;color:#6BC125;"><u>dasdas</u></span></p>
  </li>
</ol>
```

### Nested Todo-List (deep)
```html
<ul class="todo-list">
  <li data-list-item-id="...">
    <span class="todo-list__label todo-list__label_without-description">
      <span contenteditable="false"><input type="checkbox" tabindex="-1"></span>
    </span>
    <p>level 1</p>
    <ul class="todo-list">
      <li data-list-item-id="...">
        <span class="todo-list__label todo-list__label_without-description">
          <span contenteditable="false"><input type="checkbox" tabindex="-1"></span>
        </span>
        <p>level 2</p>
      </li>
    </ul>
  </li>
</ul>
```

### Links
```html
<a target="_blank" rel="noopener noreferrer" href="https://example.com">text</a>
```

### CKEditor-Unique Attributes
- `data-cke-filler="true"` on `<br>` in empty blocks
- `data-list-item-id="..."` on `<li>` (generated, stripped on save)
- `class="ck-list-marker-color"` on colored list items
- `style="--ck-content-list-marker-color:..."` CSS custom property for list markers

## Save Endpoint

Yougile web uses `POST https://yougile.com/data/description/save` (not the REST API):

```json
{
  "userId": "...",
  "key": "...",
  "companyId": "...",
  "taskId": "...",
  "description": "<h2>dasdas</h2>...",
  "date": 1775749518755,
  "v": 9,
  "appVersion": "40.44.1",
  "clientType": "web"
}
```

Jot uses `PATCH /api-v2/tasks/{id}` with `{"description": "..."}` — the same HTML format.
