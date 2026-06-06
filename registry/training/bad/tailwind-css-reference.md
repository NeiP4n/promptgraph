# Tailwind CSS Utility Reference

Core utility classes for layout, spacing, typography, colors, borders, and shadows.

## Layout Utilities

### Display

```html
<div class="block">Block</div>
<div class="inline-block">Inline Block</div>
<div class="inline">Inline</div>
<div class="flex">Flexbox</div>
<div class="inline-flex">Inline Flex</div>
<div class="grid">Grid</div>
<div class="inline-grid">Inline Grid</div>
<div class="hidden">Hidden</div>
```

### Flexbox

**Container:**
```html
<div class="flex flex-row">Row (default)</div>
<div class="flex flex-col">Column</div>
<div class="flex flex-row-reverse">Reverse row</div>
<div class="flex flex-col-reverse">Reverse column</div>
```

**Justify (main axis):**
```html
<div class="flex justify-start">Start</div>
<div class="flex justify-center">Center</div>
<div class="flex justify-end">End</div>
<div class="flex justify-between">Space between</div>
<div class="flex justify-around">Space around</div>
<div class="flex justify-evenly">Space evenly</div>
```

**Align (cross axis):**
```html
<div class="flex items-start">Start</div>
<div class="flex items-center">Center</div>
<div class="flex items-end">End</div>
<div class="flex items-baseline">Baseline</div>
<div class="flex items-stretch">Stretch</div>
```

**Gap:**
```html
<div class="flex gap-4">All sides</div>
<div class="flex gap-x-6 gap-y-2">X and Y</div>
```

**Wrap:**
```html
<div class="flex flex-wrap">Wrap</div>
<div class="flex flex-nowrap">No wrap</div>
```

### Grid

**Columns:**
```html
<div class="grid grid-cols-1">1 column</div>
<div class="grid grid-cols-2">2 columns</div>
<div class="grid grid-cols-3">3 columns</div>
<div class="grid grid-cols-4">4 columns</div>
<div class="grid grid-cols-12">12 columns</div>
<div class="grid grid-cols-[1fr_500px_2fr]">Custom</div>
```

**Rows:**
```html
<div class="grid grid-rows-3">3 rows</div>
<div class="grid grid-rows-[auto_1fr_auto]">Custom</div>
```

**Span:**
```html
<div class="col-span-2">Span 2 columns</div>
<div class="row-span-3">Span 3 rows</div>
```

### Positioning

```html
<div class="static">Static (default)</div>
<div class="relative">Relative</div>
<div class="absolute">Absolute</div>
<div class="fixed">Fixed</div>
<div class="sticky">Sticky</div>

<div class="absolute top-0 right-0">Top right</div>
<div class="absolute inset-0">All sides 0</div>
```

### Z-Index

```html
<div class="z-0">z-index: 0</div>
<div class="z-10">z-index: 10</div>
<div class="z-50">z-index: 50</div>
```

## Spacing Utilities

### Padding

```html
<div class="p-4">All sides</div>
<div class="px-6">Left and right</div>
<div class="py-3">Top and bottom</div>
<div class="pt-8">Top</div>
```

### Margin

```html
<div class="m-4">All sides</div>
<div class="mx-auto">Center horizontally</div>
<div class="my-6">Top and bottom</div>
<div class="-mt-4">Negative top</div>
```

## Typography

### Font Size

```html
<p class="text-xs">Extra small (12px)</p>
<p class="text-sm">Small (14px)</p>
<p class="text-base">Base (16px)</p>
<p class="text-lg">Large (18px)</p>
<p class="text-xl">XL (20px)</p>
<p class="text-2xl">2XL (24px)</p>
<p class="text-3xl">3XL (30px)</p>
<p class="text-4xl">4XL (36px)</p>
<p class="text-5xl">5XL (48px)</p>
```

### Font Weight

```html
<p class="font-thin">Thin (100)</p>
<p class="font-light">Light (300)</p>
<p class="font-normal">Normal (400)</p>
<p class="font-medium">Medium (500)</p>
<p class="font-semibold">Semibold (600)</p>
<p class="font-bold">Bold (700)</p>
<p class="font-black">Black (900)</p>
```

### Text Alignment

```html
<p class="text-left">Left</p>
<p class="text-center">Center</p>
<p class="text-right">Right</p>
<p class="text-justify">Justify</p>
```

### Colors

### Text Colors

```html
<p class="text-black">Black</p>
<p class="text-white">White</p>
<p class="text-gray-500">Gray 500</p>
<p class="text-red-600">Red 600</p>
<p class="text-blue-500">Blue 500</p>
<p class="text-green-600">Green 600</p>
```

### Background Colors

```html
<div class="bg-white">White</div>
<div class="bg-gray-100">Gray 100</div>
<div class="bg-blue-500">Blue 500</div>
<div class="bg-red-600">Red 600</div>
```

### Borders

### Border Width

```html
<div class="border">1px all sides</div>
<div class="border-2">2px all sides</div>
<div class="border-t">Top only</div>
<div class="border-b-2">Bottom 2px</div>
```

### Border Radius

```html
<div class="rounded">0.25rem</div>
<div class="rounded-md">0.375rem</div>
<div class="rounded-lg">0.5rem</div>
<div class="rounded-xl">0.75rem</div>
<div class="rounded-2xl">1rem</div>
<div class="rounded-full">9999px</div>
```

### Shadows

```html
<div class="shadow-sm">Small</div>
<div class="shadow">Default</div>
<div class="shadow-md">Medium</div>
<div class="shadow-lg">Large</div>
<div class="shadow-xl">Extra large</div>
<div class="shadow-2xl">2XL</div>
<div class="shadow-none">No shadow</div>
```

### Width & Height

```html
<div class="w-full">100%</div>
<div class="w-1/2">50%</div>
<div class="w-64">16rem</div>
<div class="w-[500px]">500px</div>
<div class="w-screen">100vw</div>
<div class="min-h-screen">min-height: 100vh</div>
```

## Arbitrary Values

```html
<div class="p-[17px]">Custom padding</div>
<div class="bg-[#bada55]">Hex color</div>
<div class="w-[500px]">Custom width</div>
<div class="text-[22px]">Custom font size</div>
```

## Aspect Ratio

```html
<div class="aspect-square">1:1</div>
<div class="aspect-video">16:9</div>
<div class="aspect-[4/3]">4:3</div>
```

## Overflow

```html
<div class="overflow-auto">Auto scroll</div>
<div class="overflow-hidden">Hidden</div>
<div class="overflow-x-auto">Horizontal scroll</div>
<div class="overflow-y-hidden">No vertical scroll</div>
```

## Opacity

```html
<div class="opacity-0">0%</div>
<div class="opacity-50">50%</div>
<div class="opacity-75">75%</div>
<div class="opacity-100">100%</div>
```

## Cursor

```html
<div class="cursor-pointer">Pointer</div>
<div class="cursor-not-allowed">Not allowed</div>
<div class="cursor-default">Default</div>
```

## User Select

```html
<div class="select-none">No select</div>
<div class="select-text">Text selectable</div>
<div class="select-all">Select all</div>
```
