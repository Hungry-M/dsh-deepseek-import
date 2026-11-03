用户: 帮我把这段 Python 改成异步的
```python
def fetch(url):
    return requests.get(url).text
```

助手: 用 httpx 的 AsyncClient 即可：

```python
import httpx

async def fetch(url):
    async with httpx.AsyncClient() as client:
        return (await client.get(url)).text
```

用户: 并发 100 个请求要注意什么？

助手: 用 `asyncio.gather` + 信号量限流，避免把目标站点打挂，也要设置超时。
