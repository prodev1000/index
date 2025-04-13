"""
Simple detector module for element detection.
"""

import logging
from dataclasses import dataclass
from typing import List
import random

from lmnr import observe

from index.browser.models import InteractiveElement

logger = logging.getLogger(__name__)

@dataclass
class CVDetection:
    """Computer vision detection result"""
    box: List[float]  # [x1, y1, x2, y2]
    class_name: str
    confidence: float


class Detector:
    """
    Simple detector for element detection that generates mock elements.
    """
    
    def __init__(self):
        """
        Initialize the detector.
        """
        pass
    
    @observe(name="detector.detect_from_image", ignore_input=True)
    async def detect_from_image(self, image_b64: str, detect_sheets: bool = False) -> List[InteractiveElement]:
        """
        Mock detection from image data - generates sample elements.
        
        Args:
            image_b64: Base64 encoded image (not used in this implementation)
            detect_sheets: Whether to detect sheet-like elements
            
        Returns:
            List of mock InteractiveElement objects
        """
        if detect_sheets:
            return await self._generate_sheet_elements()
        else:
            return await self._generate_cv_elements()

    async def _generate_cv_elements(self) -> List[InteractiveElement]:
        """
        Generate mock CV elements.
        
        Returns:
            List of mock InteractiveElement objects
        """
        try:
            # Generate a random number of mock elements (3-8)
            num_elements = random.randint(3, 8)
            logger.info(f"Generating {num_elements} mock CV elements")
            
            elements = []
            image_width = 800
            image_height = 600
            
            for i in range(num_elements):
                # Generate random box dimensions
                x1 = random.randint(10, image_width - 100)
                y1 = random.randint(10, image_height - 100)
                width = random.randint(50, 200)
                height = random.randint(30, 100)
                x2 = min(x1 + width, image_width)
                y2 = min(y1 + height, image_height)
                
                # Create unique ID for the CV detection
                index_id = f"cv-{i}"
                
                # Create element
                element = InteractiveElement(
                    index=i,
                    browser_agent_id=index_id,
                    tag_name="element",
                    text="",
                    attributes={},
                    weight=1,
                    viewport={
                        "x": round(x1),
                        "y": round(y1),
                        "width": round(width),
                        "height": round(height)
                    },
                    page={
                        "x": round(x1),
                        "y": round(y1),
                        "width": round(width),
                        "height": round(height)
                    },
                    center={
                        "x": round(x1 + width/2),
                        "y": round(y1 + height/2)
                    },
                    input_type=None,
                    rect={
                        "left": round(x1),
                        "top": round(y1),
                        "right": round(x2),
                        "bottom": round(y2),
                        "width": round(width),
                        "height": round(height)
                    },
                    z_index=0
                )
                
                elements.append(element)
            
            logger.info(f"Created {len(elements)} mock interactive elements")
            return elements
        except Exception as e:
            logger.error(f"Error generating mock CV elements: {e}")
            return []
    
    async def _generate_sheet_elements(self) -> List[InteractiveElement]:
        """
        Generate mock sheet elements.
        
        Returns:
            List of mock InteractiveElement objects
        """
        try:
            # Generate grid-like elements for sheets
            logger.info("Generating mock sheet elements")
            
            elements = []
            image_width = 800
            image_height = 600
            
            # Create a grid of cells (5x8)
            rows = 5
            cols = 8
            cell_width = image_width / cols
            cell_height = image_height / rows
            
            index = 0
            for row in range(rows):
                for col in range(cols):
                    x1 = col * cell_width
                    y1 = row * cell_height
                    x2 = (col + 1) * cell_width
                    y2 = (row + 1) * cell_height
                    width = cell_width
                    height = cell_height
                    
                    # Create element
                    element = InteractiveElement(
                        index=index,
                        browser_agent_id=f"cell-{row}-{col}",
                        tag_name="cell",
                        text="",
                        attributes={},
                        weight=1,
                        viewport={
                            "x": round(x1),
                            "y": round(y1),
                            "width": round(width),
                            "height": round(height)
                        },
                        page={
                            "x": round(x1),
                            "y": round(y1),
                            "width": round(width),
                            "height": round(height)
                        },
                        center={
                            "x": round(x1 + width/2),
                            "y": round(y1 + height/2)
                        },
                        input_type=None,
                        rect={
                            "left": round(x1),
                            "top": round(y1),
                            "right": round(x2),
                            "bottom": round(y2),
                            "width": round(width),
                            "height": round(height)
                        },
                        z_index=0
                    )
                    
                    elements.append(element)
                    index += 1
            
            logger.info(f"Created {len(elements)} mock sheet elements")
            return elements
        except Exception as e:
            logger.error(f"Error generating mock sheet elements: {e}")
            return []