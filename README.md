# Index

Index is a state-of-the-art browser agent that uses VLMs (vision-language models) to autonomously execute complex tasks on the web. Available as a Python package and as a hosted API.

## Index API

Index API is available on [Laminar](https://lmnr.ai). Index API manages remote browser sessions and agent infrastructure. Index API is the best way to run AI browser automation in production. To get started, [sign up](https://lmnr.ai/sign-in) and create project API key.

### Install Laminar
```bash
pip install lmnr
```

### Use Index API
```python
from lmnr import Laminar, AsyncLaminarClient
# you can also set LMNR_PROJECT_API_KEY environment variable

# Initialize tracing
Laminar.initialize(project_api_key="your_api_key")

# Initialize the client
client = AsyncLaminarClient(api_key="your_api_key")

async def main():

    # Run a task
    response = await client.agent.run(
        prompt="Navigate to news.ycombinator.com, find a post about AI, and summarize it"
    )

    # Print the result
    print(response.result)
    
if __name__ == "__main__":
    asyncio.run(main())
```

## Local Quick Start

### Install dependencies
```bash
pip install lmnr-index

# Install playwright
playwright install chromium
```

### Run the agent
```python
import asyncio
from lmnr_index import Agent, AnthropicProvider

async def main():
    # Initialize the LLM provider
    llm = AnthropicProvider(
            model="claude-3-7-sonnet-20250219",
            enable_thinking=True, 
            thinking_token_budget=2048)
    
    # Create an agent with the LLM
    agent = Agent(llm=llm)
    
    # Run the agent with a task
    output = await agent.run(
        "Navigate to news.ycombinator.com, find a post about AI, and summarize it"
    )
    
    # Print the result
    print(output.result)
    
if __name__ == "__main__":
    asyncio.run(main())
```

### Stream the agent's output
```python
from lmnr_index import Agent, AnthropicProvider

agent = Agent(llm=AnthropicProvider(model="claude-3-7-sonnet-20250219"))    

# Stream the agent's output
async for chunk in agent.run_stream(
    prompt="Navigate to news.ycombinator.com, find a post about AI, and summarize it"):
    print(chunk)
``` 

### Run with remote CDP url
```python
import asyncio
from lmnr_index import Agent, AnthropicProvider, Browser, BrowserConfig

async def main():
    # Configure browser to connect to an existing Chrome DevTools Protocol endpoint
    browser_config = BrowserConfig(
        cdp_url="ws://localhost:9222/devtools/browser/[session-id]"
    )
    
    # Create browser with the config
    browser = Browser(config=browser_config)
    
    # Initialize the LLM provider
    llm = AnthropicProvider(model="claude-3-7-sonnet-20250219")
    
    # Create an agent with the LLM and browser
    agent = Agent(llm=llm, browser=browser)
    
    # Run the agent with a task
    output = await agent.run(
        "Navigate to news.ycombinator.com and find the top story"
    )
    
    # Print the result
    print(output.result)
    
if __name__ == "__main__":
    asyncio.run(main())
```

### Customize browser window size
```python
import asyncio
from lmnr_index import Agent, AnthropicProvider, Browser, BrowserConfig

async def main():
    # Configure browser with custom viewport size
    browser_config = BrowserConfig(
        viewport_size={"width": 1920, "height": 1080}  # Full HD resolution
    )
    
    # Create browser with the config
    browser = Browser(config=browser_config)
    
    # Initialize the LLM provider
    llm = AnthropicProvider(model="claude-3-7-sonnet-20250219")
    
    # Create an agent with the LLM and browser
    agent = Agent(llm=llm, browser=browser)
    
    # Run the agent with a task
    output = await agent.run(
        "Navigate to a responsive website and capture how it looks in full HD resolution"
    )
    
    # Print the result
    print(output.result)
    
if __name__ == "__main__":
    asyncio.run(main())
```

---

Made with ❤️ by the Laminar team
