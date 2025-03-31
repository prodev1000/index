"""
Streamlined Playwright browser implementation.
"""

import asyncio
import logging
from dataclasses import dataclass, field
from importlib import resources
from typing import Any, Dict, List, Optional, TypedDict

from lmnr import observe
from playwright.async_api import (
	Browser as PlaywrightBrowser,
)
from playwright.async_api import (
	BrowserContext as PlaywrightBrowserContext,
)
from playwright.async_api import (
	Page,
	Playwright,
	async_playwright,
)
from tenacity import (
	retry,
	retry_if_exception_type,
	stop_after_attempt,
	wait_exponential,
)

# Import detector class
from index.browser.detector import Detector
from index.browser.models import (
	BrowserError,
	BrowserState,
	InteractiveElementsData,
	TabInfo,
)
from index.browser.utils import (
	combine_and_filter_elements,
	put_highlight_elements_on_screenshot,
)

logger = logging.getLogger(__name__)

INTERACTIVE_ELEMENTS_JS_CODE = resources.read_text('index.browser', 'findVisibleInteractiveElements.js')

class ViewportSize(TypedDict):
	width: int
	height: int

@dataclass
class BrowserConfig:
	"""
	Simplified configuration for the Browser.
	
	Parameters:
		cdp_url: Optional[str] = None
			Connect to a browser instance via CDP
		
		viewport_size: ViewportSize = {"width": 1024, "height": 768}
			Default browser window size
			
		cookies: Optional[List[Dict[str, Any]]] = None
			List of cookies to set
			
		cv_model_endpoint: Optional[str] = None
			SageMaker endpoint for CV model, set to None to disable CV detection
	"""
	cdp_url: Optional[str] = None
	viewport_size: ViewportSize = field(default_factory=lambda: {"width": 1024, "height": 768})
	cookies: Optional[List[Dict[str, Any]]] = None
	cv_model_endpoint: Optional[str] = None


class Browser:
	"""
	Unified Browser responsible for interacting with the browser via Playwright.
	"""

	def __init__(self, config: BrowserConfig = BrowserConfig()):
		logger.debug('Initializing browser')
		self.config = config
		
		# Playwright-related attributes
		self.playwright: Optional[Playwright] = None
		self.playwright_browser: Optional[PlaywrightBrowser] = None
		self.context: Optional[PlaywrightBrowserContext] = None
		
		# Page and state management
		self.current_page: Optional[Page] = None
		self._state: Optional[BrowserState] = None
		self._cdp_session = None
		
		# Default wait times
		self.wait_between_actions = 1.0
		
		# CV detection-related attributes
		self.detector: Optional[Detector] = None
		
		# Initialize state
		self._init_state()
		
		# Set up CV detection if endpoint is provided
		if self.config.cv_model_endpoint:
			self.setup_cv_detector(self.config.cv_model_endpoint)

	async def __aenter__(self):
		"""Async context manager entry"""
		await self._init_browser()
		return self

	async def __aexit__(self, exc_type, exc_val, exc_tb):
		"""Async context manager exit"""
		await self.close()

	def _init_state(self, url: str = '') -> None:
		"""Initialize browser state"""
		self._state = BrowserState(
			url=url,
			screenshot_with_highlights=None,
			tabs=[],
			interactive_elements={},
			cookies=self.config.cookies or [],
		)

	async def _init_browser(self):
		"""Initialize the browser and context"""
		logger.debug('Initializing browser context')
		# Start playwright if needed
		if self.playwright is None:
			self.playwright = await async_playwright().start()
		
		# Initialize browser if needed
		if self.playwright_browser is None:
			if self.config.cdp_url:
				logger.info(f'Connecting to remote browser via CDP {self.config.cdp_url}')
				self.playwright_browser = await self.playwright.chromium.connect_over_cdp(
					self.config.cdp_url
				)
			else:
				logger.info('Launching new browser instance')
				self.playwright_browser = await self.playwright.chromium.launch(
					headless=False,
					args=[
						'--no-sandbox',
						'--disable-blink-features=AutomationControlled',
						'--disable-web-security',
						'--disable-site-isolation-trials',
						'--disable-features=IsolateOrigins,site-per-process',
					]
				)
		
		# Create context if needed
		if self.context is None:

			if len(self.playwright_browser.contexts) > 0:
				self.context = self.playwright_browser.contexts[0]
			else:
				self.context = await self.playwright_browser.new_context(
					viewport=self.config.viewport_size,
				user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.102 Safari/537.36',
				java_script_enabled=True,
				bypass_csp=True,
				ignore_https_errors=True,
			)
			
			# Apply anti-detection scripts
			await self._apply_anti_detection_scripts()
			
			# Set cookies if provided
			if self.config.cookies:
				await self.context.add_cookies(self.config.cookies)
		
		# Create page if needed
		if self.current_page is None:
			if len(self.context.pages) > 0:
				self.current_page = self.context.pages[0]
			else:
				self.current_page = await self.context.new_page()
		return self
	
	def setup_cv_detector(self, endpoint_name: Optional[str] = None) -> None:
		"""
		Set up the CV detector with the browser
		
		Args:
			endpoint_name: Optional SageMaker endpoint name. If None, uses default.
		"""
		if endpoint_name is None and self.config.cv_model_endpoint is None:
			logger.warning("No CV model endpoint provided, skipping CV detector setup")
			return
			
		# Use provided endpoint or fall back to config
		endpoint = endpoint_name or self.config.cv_model_endpoint
		
		logger.info(f"Setting up CV detector with endpoint: {endpoint}")
		self.detector = Detector(endpoint_name=endpoint)
		
		return self.detector

	async def _apply_anti_detection_scripts(self):
		"""Apply scripts to avoid detection as automation"""
		await self.context.add_init_script(
			"""
			// Webdriver property
			Object.defineProperty(navigator, 'webdriver', {
				get: () => undefined
			});

			// Languages
			Object.defineProperty(navigator, 'languages', {
				get: () => ['en-US']
			});

			// Plugins
			Object.defineProperty(navigator, 'plugins', {
				get: () => [1, 2, 3, 4, 5]
			});

			// Chrome runtime
			window.chrome = { runtime: {} };

			// Permissions
			const originalQuery = window.navigator.permissions.query;
			window.navigator.permissions.query = (parameters) => (
				parameters.name === 'notifications' ?
					Promise.resolve({ state: Notification.permission }) :
					originalQuery(parameters)
			);
			(function () {
				const originalAttachShadow = Element.prototype.attachShadow;
				Element.prototype.attachShadow = function attachShadow(options) {
					return originalAttachShadow.call(this, { ...options, mode: "open" });
				};
			})();
			"""
		)
	
	async def close(self):
		"""Close the browser instance and cleanup resources"""
		logger.debug('Closing browser')
		
		try:
			# Save cookies if needed
			# (cookies saving functionality removed as it wasn't in the requested features)
			
			# Close CDP session if exists
			self._cdp_session = None
			
			# Close context
			if self.context:
				try:
					await self.context.close()
				except Exception as e:
					logger.debug(f'Failed to close context: {e}')
				self.context = None
			
			# Close browser
			if self.playwright_browser:
				try:
					await self.playwright_browser.close()
				except Exception as e:
					logger.debug(f'Failed to close browser: {e}')
				self.playwright_browser = None
			
			# Stop playwright
			if self.playwright:
				await self.playwright.stop()
				self.playwright = None
		except Exception as e:
			logger.error(f'Error during browser cleanup: {e}')
		finally:
			self.context = None
			self.current_page = None
			self._state = None
			self.playwright_browser = None
			self.playwright = None

	# def __del__(self):
	# 	"""Cleanup when object is destroyed"""
	# 	if any([self.context, self.playwright_browser, self.playwright]):
	# 		logger.debug('Browser was not properly closed before destruction')
	# 		try:
	# 			loop = asyncio.get_running_loop()
	# 			if loop.is_running():
	# 				loop.create_task(self.close())
	# 			else:
	# 				asyncio.run(self.close())
	# 		except Exception as e:
	# 			logger.warning(f'Failed to force close browser: {e}')

	# Navigation methods
	
	async def navigate_to(self, url: str):
		"""Navigate to a URL"""
		page = await self.get_current_page()
		await page.goto(url, wait_until='domcontentloaded')

	async def refresh_page(self):
		"""Refresh the current page"""
		page = await self.get_current_page()
		await page.reload()
		await page.wait_for_load_state()

	async def go_forward(self):
		"""Navigate forward in history"""
		page = await self.get_current_page()
			
		try:
			await page.go_forward(timeout=10, wait_until='domcontentloaded')
		except Exception as e:
			logger.debug(f'During go_forward: {e}')

	# Tab management methods
	
	async def get_tabs_info(self) -> list[TabInfo]:
		"""Get information about all tabs"""

		tabs_info = []
		for page_id, page in enumerate(self.context.pages):
			tab_info = TabInfo(page_id=page_id, url=page.url, title=await page.title())
			tabs_info.append(tab_info)

		return tabs_info

	async def switch_to_tab(self, page_id: int) -> None:
		"""Switch to a specific tab by its page_id"""
		if self.context is None:
			await self._init_browser()

		pages = self.context.pages
		if page_id >= len(pages):
			raise BrowserError(f'No tab found with page_id: {page_id}')

		page = pages[page_id]
		self.current_page = page

		await page.bring_to_front()
		await page.wait_for_load_state()

	async def create_new_tab(self, url: str | None = None) -> None:
		"""Create a new tab and optionally navigate to a URL"""
		if self.context is None:
			await self._init_browser()

		new_page = await self.context.new_page()
		self.current_page = new_page

		await new_page.wait_for_load_state()

		if url:
			await new_page.goto(url, wait_until='domcontentloaded')

	async def close_current_tab(self):
		"""Close the current tab"""
		if self.current_page is None:
			return
			
		await self.current_page.close()

		# Switch to the first available tab if any exist
		if self.context and self.context.pages:
			await self.switch_to_tab(0)
	
	async def get_current_page(self) -> Page:
		"""Get the current page"""
		if self.current_page is None:
			await self._init_browser()
		return self.current_page
	
	def get_state(self) -> BrowserState:
		"""Get the current browser state"""
		return self._state

	@observe(name='browser.update_state', ignore_output=True)
	async def update_state(self) -> BrowserState:
		"""Update the browser state with current page information and return it"""
		self._state = await self._update_state()
		return self._state

	@observe(name='browser._update_state', ignore_output=True)
	async def _update_state(self) -> BrowserState:
		"""Update and return state."""
		@retry(
			stop=stop_after_attempt(3),
			wait=wait_exponential(multiplier=0.5, min=0.5, max=2),
			retry=retry_if_exception_type((Exception)),
			reraise=True
		)
		async def get_stable_state():
			if self.current_page is None:
				await self._init_browser()

			screenshot_b64 = await self.fast_screenshot()
			
			# Use CV detection if available, otherwise use standard browser detection
			if self.detector is not None:
				interactive_elements_data = await self.get_interactive_elements_with_cv(screenshot_b64)
			else:
				interactive_elements_data = await self.get_interactive_elements_data()
			
			interactive_elements = {element.index: element for element in interactive_elements_data.elements}
			
			# Create highlighted version of the screenshot
			screenshot_with_highlights = put_highlight_elements_on_screenshot(
				interactive_elements, 
				screenshot_b64
			)
			
			tabs = await self.get_tabs_info()

			return BrowserState(
				url=self.current_page.url,
				tabs=tabs,
				screenshot_with_highlights=screenshot_with_highlights,
				screenshot=screenshot_b64,
				viewport=interactive_elements_data.viewport,
				interactive_elements=interactive_elements,
			)

		try:
			self._state = await get_stable_state()
			return self._state
		except Exception as e:
			logger.error(f'Failed to update state after multiple attempts: {str(e)}')
			# Return last known good state if available
			if hasattr(self, '_state'):
				return self._state
			raise
	
	@observe(name='browser.get_interactive_elements')
	async def get_interactive_elements_data(self) -> InteractiveElementsData:
		"""Get all interactive elements on the page"""
		page = await self.get_current_page()	
		result = await page.evaluate(INTERACTIVE_ELEMENTS_JS_CODE)
		interactive_elements_data = InteractiveElementsData(**result)

		return interactive_elements_data
	
	@observe(name='browser.get_interactive_elements_with_cv')
	async def get_interactive_elements_with_cv(self, screenshot_b64: Optional[str] = None) -> InteractiveElementsData:
		"""
		Get interactive elements using combined browser and CV detection.
		
		Args:
			screenshot_b64: Optional base64 encoded screenshot. If None, a new screenshot will be taken.
			
		Returns:
			Combined detection results
		"""
		if self.detector is None:
			logger.warning("CV detector not set up. Falling back to browser-only detection.")
			return await self.get_interactive_elements_data()
		
		# Take screenshot if not provided
		if screenshot_b64 is None:
			screenshot_b64 = await self.fast_screenshot()
		
		# Get browser-based detections
		browser_elements_data, cv_elements = await asyncio.gather(
			self.get_interactive_elements_data(),
			self.detector.detect_from_image(screenshot_b64)
		)
		
		# Combine and filter detections
		combined_elements = combine_and_filter_elements(
			browser_elements_data.elements, 
			cv_elements,
		)
		
		# Create new InteractiveElementsData with combined elements
		return InteractiveElementsData(
			viewport=browser_elements_data.viewport,
			elements=combined_elements
		)

	async def get_cdp_session(self):
		"""Get or create a CDP session for the current page"""
		page = await self.get_current_page()
		
		# Create a new session if we don't have one or the page has changed
		if (self._cdp_session is None or 
			not hasattr(self._cdp_session, '_page') or 
			self._cdp_session._page != self.current_page):
			self._cdp_session = await self.current_page.context.new_cdp_session(self.current_page)
			# Store reference to the page this session belongs to
			self._cdp_session._page = self.current_page
			
		return self._cdp_session

	@observe(name='browser.take_screenshot', ignore_output=True)
	async def fast_screenshot(self) -> str:
		"""
		Returns a base64 encoded screenshot of the current page.
			
		Returns:
			Base64 encoded screenshot
		"""
		# Use cached CDP session instead of creating a new one each time
		cdp_session = await self.get_cdp_session()
		screenshot_params = {
			"format": "png",
			"fromSurface": False,
			"captureBeyondViewport": False
		}
		
		# Capture screenshot using CDP Session
		screenshot_data = await cdp_session.send("Page.captureScreenshot", screenshot_params)
		screenshot_b64 = screenshot_data["data"]
		
		return screenshot_b64

	async def get_cookies(self) -> list[dict[str, Any]]:
		"""Get cookies from the browser"""
		if self.context:
			cookies = await self.context.cookies()
			return cookies
		return []