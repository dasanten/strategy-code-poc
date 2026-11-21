-- Creates the empty pixel art template files next to this script: one named slice per asset on
-- the sheets, one layer per piece of gear on the resident. Run from the repo root:
--
--   Aseprite.exe -b --script-param out=art/pixel --script-param palette=<edg32.gpl> \
--     --script art/pixel/make-templates.lua
--
-- A file that already exists is left alone, so drawn art is never overwritten. To add an asset
-- later, add a slice by hand in Aseprite (Slice tool, Shift+C) or delete the file and run again.

local TILE = 16
local GAP = TILE

local out = app.params.out or "."
local palette = app.params.palette

-- Each sheet: rows of { name, width in tiles, height in tiles (the width if left out) }. A row's
-- cells sit left to right.
local SHEETS = {
  buildings = {
    {
      { "house", 2 }, { "storage", 2 }, { "mine", 2 }, { "quarry", 2 }, { "lumber-camp", 2 },
      { "smelter", 2 }, { "mint", 2 }, { "smithy", 2 }, { "tower-wood", 2 }, { "tower-stone", 2 },
    },
    {
      { "town-hall", 3 }, { "warehouse", 3 }, { "stable", 3 }, { "training-ground", 3 },
      { "haven", 3 },
    },
    { { "farm", 4 } },
    { { "site-1x1", 1 }, { "site-2x2", 2 }, { "site-3x3", 3 }, { "site-4x4", 4 } },
    { { "city-village", 2 }, { "city-town", 2 }, { "city-large-town", 2 }, { "city-trade-org-hq", 2 } },
  },
  tiles = {
    {
      { "wall-wood-end", 1 }, { "wall-wood-straight", 1 }, { "wall-wood-corner", 1 },
      { "wall-wood-t", 1 }, { "wall-wood-cross", 1 }, { "wall-wood-post", 1 },
      { "gate-wood-ew", 1 }, { "gate-wood-ns", 1 }, { "gate-wood-open-ew", 1 },
      { "gate-wood-open-ns", 1 },
    },
    {
      { "wall-stone-end", 1 }, { "wall-stone-straight", 1 }, { "wall-stone-corner", 1 },
      { "wall-stone-t", 1 }, { "wall-stone-cross", 1 }, { "wall-stone-post", 1 },
      { "gate-stone-ew", 1 }, { "gate-stone-ns", 1 }, { "gate-stone-open-ew", 1 },
      { "gate-stone-open-ns", 1 },
    },
    {
      { "road-end", 1 }, { "road-straight", 1 }, { "road-corner", 1 }, { "road-t", 1 },
      { "road-cross", 1 }, { "road-single", 1 },
    },
    {
      { "node-forest", 1 }, { "node-stone", 1 }, { "node-iron-ore", 1 }, { "node-gold-ore", 1 },
      { "node-coal", 1 }, { "pile", 1 },
    },
  },
  goods = {
    {
      { "food", 1 }, { "wood", 1 }, { "stone", 1 }, { "iron-ore", 1 }, { "iron", 1 },
      { "gold-ore", 1 }, { "coal", 1 }, { "steel", 1 }, { "coins", 1 },
    },
    {
      { "spear", 1 }, { "sword", 1 }, { "shield", 1 }, { "armour", 1 }, { "steel-sword", 1 },
      { "steel-shield", 1 }, { "steel-armour", 1 },
    },
    { { "bow", 1 }, { "crossbow", 1 }, { "arrows", 1 } },
  },
  units = {
    {
      { "horse", 1 }, { "carriage", 1 }, { "caravan", 1 }, { "army-banner", 1 }, { "boat", 1 },
      { "ship", 1 },
    },
    -- Siege machines: their footprint isn't settled yet (Epic 110); 2×2 is a placeholder.
    -- The hitched carriage is two tiles wide: the horse in front of the cart.
    { { "ram", 2 }, { "catapult", 2 }, { "carriage-hitched", 2, 1 } },
  },
}

-- The resident, one tile, drawn from the front. Layers bottom to top; the game stacks them.
local RESIDENT_LAYERS = {
  "body", "armour", "steel-armour", "leader-crown", "shield", "steel-shield", "spear", "sword",
  "steel-sword", "bow", "crossbow",
}

local function setup(spr)
  if palette then spr:loadPalette(palette) end
  spr.gridBounds = Rectangle(0, 0, TILE, TILE)
end

local function makeSheet(name, rows)
  local path = app.fs.joinPath(out, name .. ".aseprite")
  if app.fs.isFile(path) then
    print("kept    " .. path)
    return
  end

  local cells, width, y = {}, 0, GAP
  for _, row in ipairs(rows) do
    local x, tallest = GAP, 0
    for _, item in ipairs(row) do
      local w, h = item[2] * TILE, (item[3] or item[2]) * TILE
      cells[#cells + 1] = { name = item[1], rect = Rectangle(x, y, w, h) }
      x = x + w + GAP
      tallest = math.max(tallest, h)
    end
    width = math.max(width, x)
    y = y + tallest + GAP
  end

  local spr = Sprite(width, y, ColorMode.RGB)
  setup(spr)

  -- The guide layer shows where each asset goes, one tile light, the next darker.
  local guide = Image(spr.spec)
  local light, dark = app.pixelColor.rgba(128, 128, 128, 70), app.pixelColor.rgba(128, 128, 128, 110)
  for _, cell in ipairs(cells) do
    local r = cell.rect
    for py = r.y, r.y + r.height - 1 do
      for px = r.x, r.x + r.width - 1 do
        local odd = ((px - r.x) // TILE + (py - r.y) // TILE) % 2 == 1
        guide:drawPixel(px, py, odd and dark or light)
      end
    end
    local slice = spr:newSlice(r)
    slice.name = cell.name
    slice.color = Color { r = 0, g = 120, b = 255, a = 255 }
  end
  local guideLayer = spr.layers[1]
  guideLayer.name = "guide (hide before export)"
  spr:newCel(guideLayer, spr.frames[1], guide, Point(0, 0))
  guideLayer.isEditable = false

  local art = spr:newLayer()
  art.name = "art"

  spr:saveAs(path)
  spr:close()
  print("created " .. path .. " (" .. #cells .. " slices)")
end

local function makeResident()
  local path = app.fs.joinPath(out, "resident.aseprite")
  if app.fs.isFile(path) then
    print("kept    " .. path)
    return
  end
  local spr = Sprite(TILE, TILE, ColorMode.RGB)
  setup(spr)
  spr.layers[1].name = RESIDENT_LAYERS[1]
  for i = 2, #RESIDENT_LAYERS do
    spr:newLayer().name = RESIDENT_LAYERS[i]
  end
  app.activeLayer = spr.layers[1]
  spr:saveAs(path)
  spr:close()
  print("created " .. path .. " (" .. #RESIDENT_LAYERS .. " layers)")
end

for _, name in ipairs({ "buildings", "tiles", "goods", "units" }) do
  makeSheet(name, SHEETS[name])
end
makeResident()
