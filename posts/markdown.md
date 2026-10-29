# markdown
cover: https://kkimgs.yisou.com/ims?kt=url&at=ori&key=aHR0cHM6Ly9scmQxMjM0NS5vc3MtY24tYmVpamluZy5hbGl5dW5jcy5jb20vaW1nLzRjOTFlY2I3ZmRkZTYyZTZiMjgyZmNkM2RjN2RiODIyLmpwZw==&sign=yx:4Bmm9LvOOtf3VqRWfmtVKG651yI=&tv=0_0
2024-07-15
教程
md,语法
# markdown

markdown基础语法及演示

# Headings

# H1

## H2

### H3

#### H4

##### H5

```markdown
# H1
## H2
### H3
#### H4
##### H5
```

## Heading IDs

### H3 {#3}

```markdown
### H3 {#3}
```

# Bold

**Bold text**

```markdown
**Bold text**
```

# Italic

*Italic text*

```markdown
*Italic text*
```

# Bold and Italic

***Really important***

```markdown
***Really important***
```

# Blockquotes

> No pains,no gains.

```mark
>No pain,no gain.
```

## Blockquotes with Multiple Paragraphs

> No pains,no gains.
>
> Never say die.
```mark
>No pains,no gains.
>
>Never say die.
```

## Nested Blockquotes

>No pains,no gains.
>
>>Never say die.

```markdown
>No pains,no gains.
>
>>Never say die.
```

## Blockquotes with Other Elements

> ### Ritle
>
> - Paragraph1
> - Paragraph2
>
> *Nothing* is **impossible**.

```markdown
>### Title
>
>- Paragraph1
>- Paragraph2
>
>*Nothing* is **impossible**.
```

# Lists

## Ordered Lists

1. First item
2. Second item
3. Third item
   1. Indented item1
   2. Indented item2
```markdown
1. First item
2. Second item
3. Third item
   1. Indented item1
   2. Indented item2
```

## Unordered Lists

- First item
- Second item
- Third item
  - Indented item1
  - Indented item2

```markdown
- First item
- Second item
- Third item
  - Indented item1
  - Indented item2
```

## Task Lists

- [x] item1
- [ ] item2
- [ ] item3

```markdown
- [x] item1
- [ ] item2
- [ ] item3
```

## Adding Elements in Lists

### Paragraphs

- First item

- Second item

  I need to add another paragraph below the second list item.

- Third item

```markdown
- First item

- Second item

  I need to add another paragraph below the second list item.

- Third item
```

### Blockquotes

- First item

- Second item

  > I need to add another paragraph below the second list item.

- Third item

```markdown
- First item

- Second item

  I need to add another paragraph below the second list item.

- Third item
```

# Code

`This is a code.`

```markdown
`This is a code.`
```

## Escaping Backticks

Use `code` in your Markdown file.

```markdown
Use `code` in your Markdown file.
```

# Horizontal Rules

***

---

```markdown
***
---
```

# Links

[Description](Url)

```markdown
[Description](Url)
```



## Adding Titles

[Description](https://www.example.com "Title")

```markdown
[Description](https://www.example.com "Titles")
```

## URLs and Email Addresses

<https://www.example.com>

<example@example.com>

```mark
<https://www.example.com>

<example@example.com>
```

## Formatting Links

This is the **[Description](https://www.example.com)**

```markdown
This is the **[Description](https://www.example.com)**
```

## Reference-style Links

It was collected by [example][1]

[1]:https://www.example.com

```markdown
It was collected by [example][1]

[1]:https://www.example.com
```

# Images

![Description](https://www.example.com)

```markdown
![Description](https://www.example.com)
```

# Tables

|  Syntax   | Description |
| :-------: | :---------: |
|  Header   |    Title    |
| Paragraph |    Text     |

```markdown
| Syntax      | Description |
| :-----------: | :-----------: |
| Header      | Title       |
| Paragraph   | Text        |
Alignment:
Left,Center,Right
|:---|,|:---:|,|---:|
```

# Fenced Code Blocks

```
Code1
Code2
Code3
```

```markdown
​```
Code1
Code2
Code3
​```
```

# Footnotes

Here is a simple footnote.[^1]

[^1]:This is the first footnote. 

# Strikethrough

~~Words~~

```markdown
~~Words~~
```

# Emoji

That is so funny! :joy:

```markdown
That is so funny! :joy:
:emoji shortcodes:
```

# Highlight

==Words==

```markdown
==Words==
```

# Subscript

H~2~O

```markdown
H~2~O
```

# Superscript

X^2^

```markdown
X^2^
```

