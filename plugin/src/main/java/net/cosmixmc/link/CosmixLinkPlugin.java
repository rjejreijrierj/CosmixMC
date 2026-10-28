package net.cosmixmc.link;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.SQLIntegrityConstraintViolationException;
import java.util.HexFormat;
import java.util.Locale;
import java.util.UUID;
import java.util.logging.Level;

import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

public final class CosmixLinkPlugin extends JavaPlugin implements CommandExecutor {
    private static final String CODE_PATTERN = "[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}";
    private String jdbcUrl;
    private String databaseUser;
    private String databasePassword;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        String host = getConfig().getString("database.host", "127.0.0.1");
        int port = getConfig().getInt("database.port", 3306);
        String databaseName = getConfig().getString("database.name", "cosmix");
        boolean useSsl = getConfig().getBoolean("database.useSSL", false);
        jdbcUrl = "jdbc:mysql://" + host + ":" + port + "/" + databaseName
                + "?serverTimezone=UTC&allowPublicKeyRetrieval=true&useSSL=" + useSsl;
        if (useSsl) {
            jdbcUrl += "&requireSSL=true&verifyServerCertificate=true";
        }
        databaseUser = getConfig().getString("database.username", "cosmix_plugin");
        databasePassword = getConfig().getString("database.password", "");

        if (getCommand("cosmix") == null) {
            getLogger().severe("The cosmix command is missing from plugin.yml.");
            getServer().getPluginManager().disablePlugin(this);
            return;
        }
        getCommand("cosmix").setExecutor(this);
        getLogger().info("CosmixLink enabled. Link codes are checked against the configured database.");
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage("Only players can link a Minecraft account.");
            return true;
        }
        if (args.length != 2 || !args[0].equalsIgnoreCase("link")) {
            player.sendMessage("Usage: /cosmix link <code>");
            return true;
        }

        String code = args[1].toUpperCase(Locale.ROOT);
        if (!code.matches(CODE_PATTERN)) {
            player.sendMessage("That link code is not valid. Generate a new one on the Cosmix website.");
            return true;
        }

        UUID playerId = player.getUniqueId();
        String playerName = player.getName();
        player.sendMessage("Checking your Cosmix link code...");
        getServer().getScheduler().runTaskAsynchronously(this, () -> {
            LinkResult result;
            try {
                result = redeemCode(code, playerId, playerName);
            } catch (SQLException exception) {
                getLogger().log(Level.SEVERE, "Could not redeem a Minecraft account link code.", exception);
                result = LinkResult.DATABASE_ERROR;
            }
            LinkResult finalResult = result;
            getServer().getScheduler().runTask(this, () -> sendResult(player, finalResult));
        });
        return true;
    }

    private LinkResult redeemCode(String code, UUID playerId, String playerName) throws SQLException {
        try (Connection connection = DriverManager.getConnection(jdbcUrl, databaseUser, databasePassword)) {
            connection.setAutoCommit(false);
            try {
                long accountId;
                String accountName;
                long expiresAt;
                try (PreparedStatement statement = connection.prepareStatement(
                        "SELECT user_id, expires_at FROM link_codes WHERE token_hash = ? FOR UPDATE")) {
                    statement.setString(1, hashCode(code));
                    try (ResultSet result = statement.executeQuery()) {
                        if (!result.next()) {
                            connection.rollback();
                            return LinkResult.INVALID;
                        }
                        accountId = result.getLong("user_id");
                        expiresAt = result.getLong("expires_at");
                    }
                }

                if (expiresAt < System.currentTimeMillis()) {
                    deleteCode(connection, code);
                    connection.commit();
                    return LinkResult.EXPIRED;
                }

                try (PreparedStatement statement = connection.prepareStatement(
                        "SELECT username, minecraft_uuid FROM users WHERE id = ? FOR UPDATE")) {
                    statement.setLong(1, accountId);
                    try (ResultSet result = statement.executeQuery()) {
                        if (!result.next()) {
                            deleteCode(connection, code);
                            connection.commit();
                            return LinkResult.INVALID;
                        }
                        accountName = result.getString("username");
                        if (result.getString("minecraft_uuid") != null) {
                            deleteCode(connection, code);
                            connection.commit();
                            return LinkResult.WEBSITE_ACCOUNT_ALREADY_LINKED;
                        }
                    }
                }

                try (PreparedStatement statement = connection.prepareStatement(
                        "SELECT id FROM users WHERE minecraft_uuid = ? FOR UPDATE")) {
                    statement.setString(1, playerId.toString());
                    try (ResultSet result = statement.executeQuery()) {
                        if (result.next()) {
                            deleteCode(connection, code);
                            connection.commit();
                            return LinkResult.MINECRAFT_ACCOUNT_ALREADY_LINKED;
                        }
                    }
                }

                try (PreparedStatement statement = connection.prepareStatement(
                        "UPDATE users SET minecraft_uuid = ?, minecraft_username = ? WHERE id = ? AND minecraft_uuid IS NULL")) {
                    statement.setString(1, playerId.toString());
                    statement.setString(2, playerName);
                    statement.setLong(3, accountId);
                    if (statement.executeUpdate() != 1) {
                        connection.rollback();
                        return LinkResult.WEBSITE_ACCOUNT_ALREADY_LINKED;
                    }
                }

                deleteCode(connection, code);
                connection.commit();
                return LinkResult.success(accountName);
            } catch (SQLIntegrityConstraintViolationException exception) {
                connection.rollback();
                return LinkResult.MINECRAFT_ACCOUNT_ALREADY_LINKED;
            } catch (SQLException exception) {
                connection.rollback();
                throw exception;
            }
        }
    }

    private void deleteCode(Connection connection, String code) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("DELETE FROM link_codes WHERE token_hash = ?")) {
            statement.setString(1, hashCode(code));
            statement.executeUpdate();
        }
    }

    private String hashCode(String code) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(code.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is not available.", exception);
        }
    }

    private void sendResult(Player player, LinkResult result) {
        if (!player.isOnline()) return;
        switch (result.status()) {
            case LINKED -> {
                grantRewards(player, result.accountName());
                player.sendMessage("Your Minecraft account is now linked to Cosmix account " + result.accountName() + ".");
            }
            case INVALID -> player.sendMessage("That link code is invalid or has already been used. Generate a new one on the website.");
            case EXPIRED -> player.sendMessage("That link code has expired. Generate a new one on the Cosmix website.");
            case WEBSITE_ACCOUNT_ALREADY_LINKED -> player.sendMessage("That Cosmix website account already has a Minecraft account linked.");
            case MINECRAFT_ACCOUNT_ALREADY_LINKED -> player.sendMessage("This Minecraft account is already linked to a Cosmix account.");
            case DATABASE_ERROR -> player.sendMessage("Cosmix could not verify your code right now. Please try again later.");
        }
    }

    private void grantRewards(Player player, String websiteUsername) {
        if (!getConfig().getBoolean("rewards.enabled", true)) return;

        for (String configuredCommand : getConfig().getStringList("rewards.commands")) {
            if (configuredCommand == null || configuredCommand.isBlank()) continue;
            String command = configuredCommand
                    .replace("{player}", player.getName())
                    .replace("{uuid}", player.getUniqueId().toString())
                    .replace("{website}", websiteUsername);
            if (!getServer().dispatchCommand(getServer().getConsoleSender(), command)) {
                getLogger().warning("A configured link reward command was not handled: " + command);
            }
        }
    }

    private enum Status {
        LINKED,
        INVALID,
        EXPIRED,
        WEBSITE_ACCOUNT_ALREADY_LINKED,
        MINECRAFT_ACCOUNT_ALREADY_LINKED,
        DATABASE_ERROR
    }

    private record LinkResult(Status status, String accountName) {
        private static LinkResult success(String accountName) {
            return new LinkResult(Status.LINKED, accountName);
        }

        private static LinkResult of(Status status) {
            return new LinkResult(status, null);
        }

        private static final LinkResult INVALID = of(Status.INVALID);
        private static final LinkResult EXPIRED = of(Status.EXPIRED);
        private static final LinkResult WEBSITE_ACCOUNT_ALREADY_LINKED = of(Status.WEBSITE_ACCOUNT_ALREADY_LINKED);
        private static final LinkResult MINECRAFT_ACCOUNT_ALREADY_LINKED = of(Status.MINECRAFT_ACCOUNT_ALREADY_LINKED);
        private static final LinkResult DATABASE_ERROR = of(Status.DATABASE_ERROR);
    }
}