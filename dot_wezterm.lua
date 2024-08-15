-- Pull in the wezterm API
local wezterm = require 'wezterm'

-- This will hold the configuration.
local config = wezterm.config_builder()

-- Theme and display
config.color_scheme = 'nord'
config.font_size = 16.0
config.window_padding = {
  left = 24,
  right = 24,
  top = 8,
  bottom = 8,
}

-- hide tab bar since I'm using zellij
config.enable_tab_bar = false
config.enable_scroll_bar = false
config.window_decorations = 'RESIZE'

-- and finally, return the configuration to wezterm
return config
