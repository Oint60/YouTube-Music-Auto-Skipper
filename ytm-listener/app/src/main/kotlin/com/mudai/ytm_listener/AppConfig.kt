package com.mudai.ytm_listener

data class SongFilter(
    val title: String?,
    val artist: String?
)

data class SkipRule(
    val artist: String?,
    val year: Int?,
    val allowedSongs: List<String>?,
    val matchType: String? = "includes",
    val yearOperator: String? = "newer_than"
)

data class GistSyncConfig(
    var enabled: Boolean = false,
    var token: String = "",
    var gistId: String = ""
)

data class AppConfig(
    var allowedSongs: List<SongFilter>? = null,
    var rules: List<SkipRule>? = null,
    var gistSync: GistSyncConfig? = null
)
