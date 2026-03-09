# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e3]:
    - generic [ref=e4]:
      - img [ref=e6]
      - generic [ref=e9]: FlowScale
    - generic [ref=e10]:
      - heading "Sign in" [level=1] [ref=e11]
      - generic [ref=e12]:
        - generic [ref=e13]:
          - generic [ref=e14]: Username
          - textbox "Enter your username" [ref=e15]: admin
        - generic [ref=e16]:
          - generic [ref=e17]: Password
          - textbox "Enter your password" [ref=e18]: admin
        - paragraph [ref=e19]: Invalid username or password
        - button "Sign in" [ref=e20]
    - paragraph [ref=e21]:
      - text: Need access?
      - link "Request an account" [ref=e22] [cursor=pointer]:
        - /url: /register
  - alert [ref=e23]
  - button "Open Next.js Dev Tools" [ref=e29] [cursor=pointer]:
    - img [ref=e30]
```