import pytest
from unittest.mock import AsyncMock
from backend.api_clients import calculate_padding
from backend.analyzer import enrich_media_item
from backend.models import MediaItem

def test_calculate_padding():
    assert calculate_padding(0) == 2
    assert calculate_padding(1) == 2
    assert calculate_padding(99) == 2
    assert calculate_padding(100) == 3
    assert calculate_padding(999) == 3
    assert calculate_padding(1000) == 4

@pytest.mark.asyncio
async def test_analyzer_padding_logic(mocker):
    # Mocking external API clients
    mock_tvdb = mocker.patch('backend.analyzer.TVDBClientV4')
    mock_tvdb_instance = mock_tvdb.return_value

    async def dummy_search(*args, **kwargs):
        return {
            "name": "One Piece",
            "total_episodes": 1100,
            "episodes_raw": [{"seasonNumber": 1, "number": 1, "name": "I'm Luffy! The Man Who Will Become the Pirate King!"}]
        }
    
    mock_tvdb_instance.search_series.side_effect = dummy_search

    # Simulate environment keys
    mocker.patch('os.getenv', side_effect=lambda key, default=None: "dummy" if "KEY" in key or "PIN" in key else default)

    # Test file parsed as episode
    mocker.patch('backend.analyzer.parse_filename', return_value={
        "media_type": "episode",
        "clean_title": "One Piece",
        "year": None,
        "season": 1,
        "episode": 1,
        "episode_title": None
    })

    file_path = "/media/One.Piece.01.mkv"
    item = MediaItem(
        id="dummy",
        original_path=file_path,
        original_name="One.Piece.01.mkv",
        media_type="unknown",
        status="pending"
    )
    item = await enrich_media_item(item, ["it", "en"])
    
    # 1100 total episodes means 4 padding digits. Season should be 2 digits.
    assert item.proposed_name == "One Piece - S01E0001 - I'm Luffy! The Man Who Will Become the Pirate King!.mkv"
