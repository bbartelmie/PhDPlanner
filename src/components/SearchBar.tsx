import React from 'react';
import { Search, X } from 'lucide-react';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SearchBar({ value, onChange, placeholder = "Search..." }: SearchBarProps) {
  return (
    <div className="search-bar">
      <div className="search-input-wrapper">
        <Search size={16} className="search-icon" />
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="search-input"
        />
        {value && (
          <button
            onClick={() => onChange('')}
            className="clear-search-btn"
            title="Clear search"
          >
            <X size={16} />
          </button>
        )}
      </div>
    </div>
  );
}